import { BrandingHandle, generateBranding, playBranding } from './branding'
import { LOCAL_RECORDING_SERVER_LOCATION, delSessionInRedis } from './instance'
import { Logger, uploadLog } from './logger'
import {
    getCachedExtensionId,
    listenPage,
    openBrowser,
    removeListenPage,
} from './puppeteer'
import {
    CancellationToken,
    ChangeAgendaRequest,
    // TODO : language_code - 99% sure it is trash code
    // ChangeLanguage,
    Meeting,
    MeetingParams,
    MeetingProvider,
    MeetingProviderInterface,
    MeetingStatus,
    SpeakerData,
} from './types'

import { notifyApp } from './calendar'
import { Events } from './events'
import { MeetProvider } from './meeting/meet'
import { TeamsProvider } from './meeting/teams'
import { ZoomProvider } from './meeting/zoom'
import { sleep } from './utils'
import { VideoContext } from './media_context'

const RECORDING_TIMEOUT = 3600 * 4 // 4 hours
// const RECORDING_TIMEOUT = 120 // 2 minutes for tests
const MAX_TIME_TO_LIVE_AFTER_TIMEOUT = 3600 * 2 // 2 hours

export class JoinError extends Error {
    constructor(code: JoinErrorCode) {
        super(code)
        this.name = 'JoinError'
    }
}

export enum JoinErrorCode {
    CannotJoinMeeting = 'CannotJoinMeeting',
    BotNotAccepted = 'BotNotAccepted',
    BotRemoved = 'BotRemoved',
    TimeoutWaitingToStart = 'TimeoutWaitingToStart',
    Internal = 'InternalError',
    InvalidMeetingUrl = 'InvalidMeetingUrl',
}

export class Status {
    state: MeetingStatus
    error: any | null
    project: { id: number; share_link?: string } | null
    constructor() {
        this.state = 'Recording'
        this.error = null
        this.project = null
    }
}

export class MeetingHandle {
    static instance: MeetingHandle = null
    static status: Status = new Status()
    private logger: Logger
    private meeting: Meeting
    private param: MeetingParams
    private brandingGenerateProcess: BrandingHandle | null
    private provider: MeetingProviderInterface

    static init(meetingParams: MeetingParams, logger: Logger) {
        if (MeetingHandle.instance == null) {
            this.instance = new MeetingHandle(meetingParams, logger)
            console.log(
                '*** INIT MeetingHandle.instance',
                meetingParams.meeting_url,
            )
        }
    }
    static getUserId(): number | null {
        return MeetingHandle.instance.param.user_id
    }
    static getProject(): { id: number } | null {
        return MeetingHandle.status?.project
    }
    static getError(): any | null {
        return MeetingHandle.status?.error
    }
    static getStatus(): MeetingStatus | null {
        return MeetingHandle.status?.state
    }
    static getBotId(): string {
        return MeetingHandle.instance.param.bot_id
    }
    static addSpeaker(speaker: SpeakerData) {
        MeetingHandle.instance.meeting.backgroundPage!.evaluate((x) => {
            const w = window as any
            return w.addSpeaker(x)
        }, speaker)
    }
    constructor(meetingParams: MeetingParams, logger: Logger) {
        function detectMeetingProvider(url: string): MeetingProvider {
            if (url.includes('https://teams')) {
                return 'Teams'
            } else if (url.includes('https://meet')) {
                return 'Meet'
            } else {
                return 'Zoom'
            }
        }

        function newMeetingProvider(
            meetingProvider: MeetingProvider,
        ): MeetingProviderInterface {
            if (meetingProvider === 'Teams') {
                return new TeamsProvider()
            } else if (meetingProvider === 'Meet') {
                return new MeetProvider()
            } else {
                return new ZoomProvider()
            }
        }
        console.log(
            '************ meetingParams meeting_url!!!',
            meetingParams.meeting_url,
        )
        meetingParams.meetingProvider = detectMeetingProvider(
            meetingParams.meeting_url,
        )
        this.provider = newMeetingProvider(meetingParams.meetingProvider)
        this.param = meetingParams
        this.logger = logger
        this.meeting = {
            page: null,
            backgroundPage: null,
            browser: null,
            meetingTimeoutInterval: null,
        }
        this.param.local_recording_server_location =
            LOCAL_RECORDING_SERVER_LOCATION
    }

    public async startRecordMeeting() {
        try {
            if (this.param.bot_branding) {
                this.brandingGenerateProcess = generateBranding(
                    this.param.bot_name,
                    this.param.custom_branding_bot_path,
                )
                await this.brandingGenerateProcess.wait
                playBranding()
            }

            const extensionId = await getCachedExtensionId()
            const { browser, backgroundPage } = await openBrowser(extensionId)
            this.meeting.browser = browser
            this.meeting.backgroundPage = backgroundPage
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
                this.param.enter_message,
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
                RECORDING_TIMEOUT * 1000, // 4 hours in ms
            )

            await Events.inWaitingRoom()

            const waintingRoomToken = new CancellationToken(
                this.param.automatic_leave.waiting_room_timeout,
            )
            console.log(
                'waitingroom timeout',
                this.param.automatic_leave.waiting_room_timeout,
            )
            try {
                await this.provider.joinMeeting(
                    this.meeting.page,
                    () => {
                        return (
                            MeetingHandle.status.state !== 'Recording' ||
                            waintingRoomToken.isCancellationRequested
                        )
                    },
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
                async (meuh) => {
                    const w = window as any
                    return await w.startRecording(meuh)
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
                throw new JoinError(JoinErrorCode.Internal)
            }

            MeetingHandle.status.project = project
            return project
        } catch (error) {
            await this.cleanEverything(true)
            MeetingHandle.status.error = error
            throw error
        }
    }

    private async cleanEverything(failed: boolean) {
        try {
            await uploadLog(
                this.param.user_id,
                this.param.email,
                this.param.bot_id,
                MeetingHandle.status.project?.id,
                MeetingHandle.status.project?.share_link,
            )
        } catch (e) {
            this.logger.error(`failed to upload logs: ${e}`)
        }
        try {
            this.brandingGenerateProcess?.kill()
            VideoContext.instance.stop()
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
        try {
            await this.meeting.page?.close()
        } catch (e) {
            console.error(e)
        }
        try {
            await this.meeting.backgroundPage?.close()
        } catch (e) {
            console.error(e)
        }
        try {
            await this.meeting.browser?.close()
        } catch (e) {
            console.error(e)
        }
        try {
            clearTimeout(this.meeting.meetingTimeoutInterval!)
        } catch (e) {
            console.error(e)
        }
    }

    public async recordMeetingToEnd() {
        console.log('[recordMeetingToEnd]')
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
        console.log('waiting for end meeting')
        const cancelationToken = new CancellationToken(
            this.param.automatic_leave.noone_joined_timeout,
        )
        while (MeetingHandle.status.state === 'Recording') {
            if (
                await this.provider.findEndMeeting(
                    this.param,
                    this.meeting.page!,
                    cancelationToken,
                )
            ) {
                return
            } else {
                console.log('[waiting for end meeting] meeting not ended')
                await sleep(1000)
            }
        }
    }

    public async getAgenda(): Promise<any | undefined> {
        const agenda = await this.meeting.backgroundPage!.evaluate(async () => {
            const w = window as any
            return await w.getAgenda()
        })
        return agenda
    }

    public async changeAgenda(data: ChangeAgendaRequest) {
        this.logger.info('Changing agenda', {
            new_agenda: data.agenda_id,
        })
        await this.meeting.backgroundPage!.evaluate(async (data) => {
            const w = window as any
            await w.changeAgenda(data)
        }, data)
    }

    // TODO : language_code - 99% sure it is trash code
    // public async changeLanguage(data: ChangeLanguage) {
    //     this.logger.info('Changing language', {
    //         new_language: data.language,
    //     })
    //     await this.meeting.backgroundPage!.evaluate(async (data) => {
    //         const w = window as any
    //         await w.changeLanguage(data)
    //     }, data)
    // }

    public async stopRecording(reason: string) {
        if (MeetingHandle.status.state !== 'Recording') {
            this.logger.error(
                `Can't exit meeting, the meeting is not in recording state`,
                { status: MeetingHandle.status.state, exit_reason: reason },
            )
            return
        }
        MeetingHandle.status.state = 'Cleanup'
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
        await backgroundPage!.evaluate(async () => {
            const w = window as any
            await w.stopMediaRecorder()
        })
        try {
            await page!.goto('about:blank')
        } catch (e) {
            console.error(e)
        }

        try {
            clearTimeout(meetingTimeoutInterval!)
        } catch (e) {
            console.error(e)
        }
        try {
            await page!.close()
        } catch (e) {
            this.logger.error(`Failed to close page: ${e}`)
        }

        this.logger.info('Waiting for all chunks to be uploaded')
        await backgroundPage!.evaluate(async () => {
            const w = window as any
            await w.waitForUpload()
        })
        this.logger.info('All chunks uploaded')
        try {
            removeListenPage(backgroundPage!)
            await backgroundPage!.close()
            await sleep(1)
            await browser!.close()
        } catch (e) {
            console.error(`Failed to close browser: ${e}`)
        }
        this.logger.info('Meeting successfully terminated')
    }

    private meetingTimeout() {
        this.logger.info('stopping meeting timeout reason')
        try {
            this.stopRecording('timeout')
        } catch (e) {
            console.error(e)
        }
        setTimeout(async () => {
            this.logger.info('killing process')
            //TODO : appeler clean everything
            try {
                await uploadLog(
                    this.param.user_id,
                    this.param.email,
                    this.param.bot_id,
                    MeetingHandle.status.project?.id,
                    MeetingHandle.status.project?.share_link,
                )
            } catch (e) {
                console.error(e)
            }
            process.exit(0)
        }, MAX_TIME_TO_LIVE_AFTER_TIMEOUT * 1000)
    }
}
