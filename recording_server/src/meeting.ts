import { BrandingHandle, generateBranding, playBranding } from './branding'
import { Logger, uploadLog } from './logger'
import { MeetProvider } from './meeting/meet'
import { TeamsProvider } from './meeting/teams'
import { ZoomProvider } from './meeting/zoom'
import {
    findBackgroundPage,
    getCachedExtensionId,
    listenPage,
    openBrowser,
    removeListenPage,
} from './puppeteer'

import { notifyApp } from './calendar'
import { Events } from './events'
import { delSessionInRedis } from './instance'
import {
    CancellationToken,
    ChangeAgendaRequest,
    ChangeLanguage,
    Meeting,
    MeetingParams,
    MeetingProvider,
    MeetingProviderInterface,
    MeetingStatus,
} from './types'
import { sleep } from './utils'

export class MeetingHandle {
    static instance: MeetingHandle = null
    private logger: Logger
    private status: MeetingStatus
    private project: { id: number } | null
    private error: any | null
    private meeting: Meeting
    private param: MeetingParams
    private brandingGenerateProcess: BrandingHandle | null
    private brandingPlayProcess: BrandingHandle | null
    private provider: MeetingProviderInterface

    static init(meetingParams: MeetingParams, logger: Logger) {
        if (MeetingHandle.instance == null) {
            this.instance = new MeetingHandle(meetingParams, logger)
        }
    }
    static getProject(): { id: number } | null {
        return MeetingHandle.instance?.project
    }
    static getError(): any | null {
        return MeetingHandle.instance?.error
    }
    static getStatus(): MeetingStatus | null {
        return MeetingHandle.instance?.status
    }

    constructor(meetingParams: MeetingParams, logger: Logger) {
        function detectMeetingProvider(url: string) {
            if (url.includes('https://teams')) {
                return 'Teams'
            } else if (url.includes('https://meet')) {
                return 'Meet'
            } else {
                return 'Zoom'
            }
        }

        function newMeetingProvider(meetingProvider: MeetingProvider) {
            if (meetingProvider === 'Teams') {
                return new TeamsProvider()
            } else if (meetingProvider === 'Meet') {
                return new MeetProvider()
            } else {
                return new ZoomProvider()
            }
        }

        meetingParams.meetingProvider = detectMeetingProvider(
            meetingParams.meeting_url,
        )
        this.provider = newMeetingProvider(meetingParams.meetingProvider)
        this.param = meetingParams
        this.status = 'Recording'
        this.logger = logger
        this.meeting = {
            page: null,
            backgroundPage: null,
            browser: null,
            meetingTimeoutInterval: null,
        }
    }

    public async startRecordMeeting() {
        try {
            if (this.param.bot_branding) {
                this.brandingGenerateProcess = generateBranding(
                    this.param.bot_name,
                    this.param.custom_branding_bot_path,
                )
                await this.brandingGenerateProcess.wait
                this.brandingPlayProcess = playBranding()
            }

            const extensionId = await getCachedExtensionId()
            this.meeting.browser = await openBrowser(extensionId)
            this.meeting.backgroundPage = await findBackgroundPage(
                this.meeting.browser,
                extensionId,
            )
            this.logger.info('Extension found', { extensionId })

            const { meetingId, password } = await this.provider.parseMeetingUrl(
                this.meeting.browser,
                this.param.meeting_url,
            )
            this.logger.info('meeting id found', { meetingId })

            const meetingLink = this.provider.getMeetingLink(
                meetingId,
                password,
                0,
                this.param.bot_name,
            )
            this.logger.info('Meeting link found', { meetingLink })

            this.meeting.page = await this.provider.openMeetingPage(
                this.meeting.browser,
                meetingLink,
            )
            this.logger.info('meeting page opened')

            this.meeting.meetingTimeoutInterval = setTimeout(
                () => {
                    MeetingHandle.instance?.meetingTimeout()
                },
                4 * 60 * 60 * 1000, // 4 hours
            )

            await Events.inWaitingRoom()

            const waintingRoomToken = new CancellationToken(
                this.param.automatic_leave.waiting_room_timeout,
            )

            try {
                await this.provider.joinMeeting(
                    this.meeting.page,
                    waintingRoomToken,
                    this.param,
                )
                this.logger.info('meeting page joined')
            } catch (error) {
                console.error(error)
                throw error
            }

            listenPage(this.meeting.backgroundPage)
            await Events.inCallNotRecording()

            const project = await this.meeting.backgroundPage.evaluate(
                async (meetingParams) => {
                    const w = window as any
                    return await w.startRecording(meetingParams)
                },
                {
                    ...this.param,
                    s3_bucket: process.env.AWS_S3_BUCKET,
                    api_server_baseurl: process.env.API_SERVER_BASEURL,
                    api_bot_baseurl: process.env.API_BOT_BASEURL,
                },
            )
            this.logger.info('startRecording called')

            await Events.inCallRecording()

            if (project == null) {
                throw 'failed creating project'
            }

            this.project = project
            return project
        } catch (e) {
            console.error('an error occured while starting recording', e)
            console.error('setting current_meeting error')
            this.error = e
            console.error('after set current meeting error')
            await this.cleanEverything(true)
            throw e
        }
    }

    private async cleanEverything(failed: boolean) {
        try {
            await uploadLog()
        } catch (e) {
            this.logger.error(`failed to upload logs: ${e}`)
        }
        try {
            this.brandingGenerateProcess?.kill()
            this.brandingPlayProcess?.kill()
        } catch (e) {
            this.logger.error(`failed to kill process: ${e}`)
        }
        await this.cleanMeeting()
        try {
            await delSessionInRedis(this.param.session_id)
        } catch (e) {
            this.logger.error(`failed to del session in redis: ${e}`)
        }
    }
    private async cleanMeeting() {
        // try { removeListenPage(meeting.backgroundPage) } catch (e) { console.error(e) }
        try {
            await this.meeting.page.close()
        } catch (e) {
            console.error(e)
        }
        try {
            await this.meeting.backgroundPage.close()
        } catch (e) {
            console.error(e)
        }
        try {
            await this.meeting.browser.close()
        } catch (e) {
            console.error(e)
        }
        try {
            clearTimeout(this.meeting.meetingTimeoutInterval)
        } catch (e) {
            console.error(e)
        }
    }

    public async recordMeetingToEnd() {
        await this.waitForEndMeeting()

        this.logger.info('after waitForEndMeeting')
        await Events.callEnded()

        try {
            await this.stopRecordingInternal()
        } catch (e) {
            this.logger.error(`Failed to stop recording: ${e}`)
        } finally {
            await this.cleanEverything(false)
        }
    }

    private async waitForEndMeeting() {
        const cancelationToken = new CancellationToken(
            this.param.automatic_leave.noone_joined_timeout,
        )
        while (this.status == 'Recording') {
            if (
                await this.provider.findEndMeeting(
                    this.param,
                    this.meeting.page,
                    cancelationToken,
                )
            ) {
                return
            } else {
                await sleep(1000)
            }
        }
    }

    public async getAgenda(): Promise<any | undefined> {
        const agenda = await this.meeting.backgroundPage.evaluate(async () => {
            const w = window as any
            return await w.getAgenda()
        })
        return agenda
    }

    public async changeAgenda(data: ChangeAgendaRequest) {
        this.logger.info('Changing agenda', {
            new_agenda: data.agenda_id,
        })
        await this.meeting.backgroundPage.evaluate(async (data) => {
            const w = window as any
            await w.changeAgenda(data)
        }, data)
    }
    public async changeLanguage(data: ChangeLanguage) {
        this.logger.info('Changing language', {
            new_language: data.language,
        })
        // this.logger.error('Can\'t change language, the feature is desactivated')
        await this.meeting.backgroundPage.evaluate(async (data) => {
            const w = window as any
            await w.changeLanguage(data)
        }, data)
    }
    public async stopRecording(reason: string) {
        if (this.status == null) {
            this.logger.error(
                `Can't exit metting, there is no pending meeting`,
                { exit_reason: reason },
            )
            return
        } else if (this.status != 'Recording') {
            this.logger.error(
                `Can't exit metting, the meeting is not in recording state`,
                { status: this.status, exit_reason: reason },
            )
            return
        }
        this.status = 'Cleanup'
        this.logger.info(`Stop recording scheduled`, {
            exit_reason: reason,
        })
    }

    private async stopRecordingInternal() {
        try {
            await notifyApp(
                'EndRecording',
                this.param,
                {},
                { session_id: this.param.session_id },
            )
        } catch (e) {}
        let { page, meetingTimeoutInterval, browser, backgroundPage } =
            this.meeting
        await backgroundPage.evaluate(async () => {
            const w = window as any
            await w.stopMediaRecorder()
        })
        try {
            await page.goto('about:blank')
        } catch (e) {
            console.error(e)
        }

        try {
            clearTimeout(meetingTimeoutInterval)
        } catch (e) {
            console.error(e)
        }
        try {
            await page.close()
        } catch (e) {
            this.logger.error(`Failed to close page: ${e}`)
        }

        this.logger.info('Waiting for all chunks to be uploaded')
        await backgroundPage.evaluate(async () => {
            const w = window as any
            await w.waitForUpload()
        })
        this.logger.info('All chunks uploaded')
        // browser.disconnect()
        try {
            removeListenPage(backgroundPage)
            await backgroundPage.close()
            await sleep(1)
            await browser.close()
        } catch (e) {
            console.error(`Failed to close browser: ${e}`)
        }
        this.logger.info('Meeting successfully terminated')
    }
    private meetingTimeout() {
        this.logger.info('stoping meeting tiemout reason')
        try {
            this.stopRecording('timeout')
        } catch (e) {
            console.error(e)
        }
        setTimeout(async () => {
            this.logger.info('killing process')
            try {
                await uploadLog()
            } catch (e) {
                console.error(e)
            }
            process.exit(0)
        }, 5 * 60 * 1000)
    }
}
