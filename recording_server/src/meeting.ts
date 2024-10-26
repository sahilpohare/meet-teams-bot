import { BrandingHandle, generateBranding, playBranding } from './branding'
import { LOCAL_RECORDING_SERVER_LOCATION, delSessionInRedis } from './instance'
import { SoundContext, VideoContext } from './media_context'
import {
    getCachedExtensionId,
    listenPage,
    openBrowser,
    removeListenPage,
} from './puppeteer'
import {
    CancellationToken,
    Meeting,
    MeetingParams,
    MeetingProvider,
    MeetingProviderInterface,
    MeetingStatus,
    SpeakerData,
} from './types'

import { Events } from './events'
import { uploadLog } from './logger'
import { MeetProvider } from './meeting/meet'
import { TeamsProvider } from './meeting/teams'
import { ZoomProvider } from './meeting/zoom'
import { sleep } from './utils'

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
    constructor() {
        this.state = 'Recording'
        this.error = null
    }
}

export class MeetingHandle {
    static instance: MeetingHandle = null
    static status: Status = new Status()
    private meeting: Meeting
    private param: MeetingParams
    private brandingGenerateProcess: BrandingHandle | null
    private provider: MeetingProviderInterface

    static init(meetingParams: MeetingParams) {
        if (MeetingHandle.instance == null) {
            this.instance = new MeetingHandle(meetingParams)
            console.log(
                '*** INIT MeetingHandle.instance',
                meetingParams.meeting_url,
            )
        }
    }
    static getUserId(): number | null {
        return MeetingHandle.instance.param.user_id
    }
    static getError(): any | null {
        return MeetingHandle.status?.error
    }
    static getStatus(): MeetingStatus | null {
        return MeetingHandle.status?.state
    }
    static getBotId(): string {
        return MeetingHandle.instance.param.bot_uuid
    }
    static addSpeaker(speaker: SpeakerData) {
        MeetingHandle.instance.meeting.backgroundPage!.evaluate((x) => {
            const w = window as any
            return w.addSpeaker(x)
        }, speaker)
    }
    static stopAudioStreaming() {
        MeetingHandle.instance.meeting.backgroundPage!.evaluate(() => {
            const w = window as any
            return w.stopAudioStreaming()
        })
    }
    constructor(meetingParams: MeetingParams) {
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
            const { browser, backgroundPage } = await openBrowser(
                extensionId,
                // this.param.meetingProvider === 'Zoom',
                false,
            )
            this.meeting.browser = browser
            this.meeting.backgroundPage = backgroundPage
            console.log('Extension found', { extensionId })

            const { meetingId, password } = await this.provider.parseMeetingUrl(
                this.meeting.browser,
                this.param.meeting_url,
            )
            console.log('meeting id found', { meetingId })

            const meetingLink = this.provider.getMeetingLink(
                meetingId,
                password,
                0,
                this.param.bot_name,
                this.param.enter_message,
            )
            console.log('Meeting link found', { meetingLink })

            this.meeting.page = await this.provider.openMeetingPage(
                this.meeting.browser,
                meetingLink,
                this.param.streaming_input,
            )
            console.log('meeting page opened')

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
                console.log('meeting page joined')
            } catch (error) {
                console.error(error)
                throw error
            }

            listenPage(this.meeting.backgroundPage)
            await Events.inCallNotRecording()

            const startRecordSuccess =
                await this.meeting.backgroundPage.evaluate(
                    async (meuh) => {
                        try {
                            const w = window as any
                            await w.startRecording(meuh)
                            return true
                        } catch (error) {
                            console.error(error)
                            return false
                        }
                    },
                    {
                        ...this.param,
                        s3_bucket: process.env.AWS_S3_BUCKET,
                        api_server_baseurl: process.env.API_SERVER_BASEURL,
                        api_bot_baseurl: process.env.API_BOT_BASEURL,
                    },
                )
            console.log('startRecording called')

            await Events.inCallRecording()

            if (startRecordSuccess === false) {
                throw new JoinError(JoinErrorCode.Internal)
            }
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
                this.param.bot_uuid,
            )
        } catch (e) {
            console.error(`failed to upload logs: ${e}`)
        }
        try {
            this.brandingGenerateProcess?.kill()
            VideoContext.instance.stop()
            SoundContext.instance.stop()
        } catch (e) {
            console.error(`failed to kill process: ${e}`)
        }
        await this.cleanMeeting()
        try {
            await delSessionInRedis(this.param.session_id)
        } catch (e) {
            console.error(`failed to del session in redis: ${e}`)
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

        console.log('after waitForEndMeeting')
        await Events.callEnded()

        MeetingHandle.stopAudioStreaming()
        try {
            await this.stopRecordingInternal()
        } catch (e) {
            console.error(`Failed to stop recording: ${e}`)
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
            try {
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
            } catch (e) {
                console.error(
                    '[waitForEndMeeting] find EndMeeting crashed with error: ',
                    e,
                )
            }
        }
    }

    public async stopRecording(reason: string) {
        if (MeetingHandle.status.state !== 'Recording') {
            console.error(
                `Can't exit meeting, the meeting is not in recording state`,
                { status: MeetingHandle.status.state, exit_reason: reason },
            )
            return
        }
        MeetingHandle.status.state = 'Cleanup'
        console.log(`Stop recording scheduled`, {
            exit_reason: reason,
        })
    }

    private async stopRecordingInternal() {
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
            console.error(`Failed to close page: ${e}`)
        }

        console.log('Waiting for all chunks to be uploaded')
        await backgroundPage!.evaluate(async () => {
            const w = window as any
            await w.waitForUpload()
        })
        console.log('All chunks uploaded')
        try {
            removeListenPage(backgroundPage!)
            await backgroundPage!.close()
            await sleep(1)
            await browser!.close()
        } catch (e) {
            console.error(`Failed to close browser: ${e}`)
        }
        console.log('Meeting successfully terminated')
    }

    private meetingTimeout() {
        console.log('stopping meeting timeout reason')
        try {
            this.stopRecording('timeout')
        } catch (e) {
            console.error(e)
        }
        setTimeout(async () => {
            console.log('killing process')
            //TODO : appeler clean everything
            try {
                await uploadLog(
                    this.param.user_id,
                    this.param.email,
                    this.param.bot_uuid,
                )
            } catch (e) {
                console.error(e)
            }
            process.exit(0)
        }, MAX_TIME_TO_LIVE_AFTER_TIMEOUT * 1000)
    }
}
