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
import { Logger } from './logger'
import { MeetProvider } from './meeting/meet'
import { TeamsProvider } from './meeting/teams'
import { ZoomProvider } from './meeting/zoom'
import { Console, sleep } from './utils'
import { uploadTranscriptTask } from './uploadTranscripts'

let _NO_SPEAKER_DETECTED_TIMESTAMP: number | null = null
export const NO_SPEAKER_DETECTED_TIMESTAMP = {
    get: () => _NO_SPEAKER_DETECTED_TIMESTAMP,
    set: (value: number | null) => {
        _NO_SPEAKER_DETECTED_TIMESTAMP = value
    },
}
let _START_RECORDING_TIMESTAMP: number | null = null
export const START_RECORDING_TIMESTAMP = {
    get: () => _START_RECORDING_TIMESTAMP,
    set: (value: number | null) => {
        _START_RECORDING_TIMESTAMP = value
    },
}

let _NUMBER_OF_ATTENDEES: number | null = null
export const NUMBER_OF_ATTENDEES = {
    get: () => _NUMBER_OF_ATTENDEES,
    set: (value: number | null) => {
        _NUMBER_OF_ATTENDEES = value
    },
}

let _FIRST_USER_JOINED: boolean = false
export const FIRST_USER_JOINED = {
    get: () => _FIRST_USER_JOINED,
    set: (value: boolean) => {
        _FIRST_USER_JOINED = value
    },
}

const NO_SPEAKER_THRESHOLD = 1000 * 60 * 7 // 7 minutes
const NO_SPEAKER_DETECTED_TIMEOUT = 1000 * 60 * 15 // 15 minutes
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

export class MeetingHandle extends Console {
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
    static stopAudioStreaming() {
        MeetingHandle.instance.meeting.backgroundPage!.evaluate(() => {
            const w = window as any
            return w.stopAudioStreaming()
        })
    }
    constructor(meetingParams: MeetingParams) {
        super()
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
        this.log(
            '************ meetingParams meeting_url!!!',
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
        // TODO : Remove that when we will develop gallery_view
        this.param.recording_mode =
            this.param.recording_mode == 'gallery_view'
                ? 'speaker_view'
                : this.param.recording_mode
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
                false,
                // this.param.meetingProvider === 'Zoom',
                false,
            )
            this.meeting.browser = browser
            this.meeting.backgroundPage = backgroundPage
            this.log('Extension found', { extensionId })

            const { meetingId, password } = await this.provider.parseMeetingUrl(
                this.meeting.browser,
                this.param.meeting_url,
            )
            this.log('meeting id found', { meetingId })

            const meetingLink = this.provider.getMeetingLink(
                meetingId,
                password,
                0,
                this.param.bot_name,
                this.param.enter_message,
            )
            this.log('Meeting link found', { meetingLink })

            this.meeting.page = await this.provider.openMeetingPage(
                this.meeting.browser,
                meetingLink,
                this.param.streaming_input,
            )
            this.log('meeting page opened')

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
            this.log(
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
                this.log('meeting page joined')
            } catch (error) {
                this.error(error)
                throw error
            }

            listenPage(this.meeting.backgroundPage)
            await Events.inCallNotRecording()

            // Start recording
            let result: string | number =
                await this.meeting.backgroundPage.evaluate(
                    async (meuh) => {
                        try {
                            const w = window as any
                            let res = await w.startRecording(meuh)
                            return res as number
                        } catch (error) {
                            return error as string
                        }
                    },
                    {
                        ...this.param,
                        s3_bucket: process.env.AWS_S3_VIDEO_BUCKET,
                        api_server_baseurl: process.env.API_SERVER_BASEURL,
                    },
                )
            if (typeof result === 'number') {
                this.info(`START_RECORDING_TIMESTAMP = ${result}`)
                START_RECORDING_TIMESTAMP.set(result)
            } else {
                this.error(`Unexpected error: ${result}`)
                throw new JoinError(JoinErrorCode.Internal)
            }
            // Start to observe speakers
            await this.meeting.backgroundPage.evaluate(async () => {
                const w = window as any
                await w.start_speakers_observer()
            })
            this.log('startRecording called')
            // Send recording confirmation webhook
            await Events.inCallRecording()
        } catch (error) {
            await this.cleanEverything()
            MeetingHandle.status.error = error
            throw error
        }
    }

    private async cleanEverything() {
        try {
            await Logger.instance.upload_log()
        } catch (e) {
            this.error(`failed to upload logs: ${e}`)
        }
        try {
            this.brandingGenerateProcess?.kill()
            VideoContext.instance?.stop()
            SoundContext.instance?.stop()
        } catch (e) {
            this.error(`failed to kill process: ${e}`)
        }
        await this.cleanMeeting()
        try {
            await delSessionInRedis(this.param.session_id)
        } catch (e) {
            this.error(`failed to del session in redis: ${e}`)
        }
    }

    private async cleanMeeting() {
        try {
            await this.meeting.page?.close()
        } catch (e) {}
        try {
            await this.meeting.backgroundPage?.close()
        } catch (e) {}
        try {
            await this.meeting.browser?.close()
        } catch (e) {}
        try {
            clearTimeout(this.meeting.meetingTimeoutInterval!)
        } catch (e) {}
    }

    public async recordMeetingToEnd() {
        this.log('[recordMeetingToEnd]')
        await this.waitForEndMeeting()

        this.log('after waitForEndMeeting')
        await Events.callEnded()

        MeetingHandle.stopAudioStreaming()
        try {
            await this.stopRecordingInternal()
        } catch (e) {
            this.error(`Failed to stop recording: ${e}`)
        } finally {
            this.log('before cleanEverything')
            await this.cleanEverything()
            this.log('after cleanEverything')
        }
    }

    private async waitForEndMeeting() {
        this.log('waiting for end meeting')
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
            let now = Date.now()
            if (
                (NUMBER_OF_ATTENDEES.get() === 0 &&
                    START_RECORDING_TIMESTAMP.get() + NO_SPEAKER_THRESHOLD <
                        now) ||
                (NUMBER_OF_ATTENDEES.get() === 0 && FIRST_USER_JOINED.get())
            ) {
                await this.stopRecording('no attendees')
                return
            } else if (
                START_RECORDING_TIMESTAMP.get() !== null &&
                START_RECORDING_TIMESTAMP.get() + NO_SPEAKER_THRESHOLD < now &&
                NO_SPEAKER_DETECTED_TIMESTAMP.get() !== null &&
                NO_SPEAKER_DETECTED_TIMESTAMP.get() +
                    NO_SPEAKER_DETECTED_TIMEOUT <
                    now
            ) {
                await this.stopRecording('no speaker detected timeout')
                return
            } else {
                this.log(
                    '[waiting for end meeting] no speaker detected timestamp',
                    START_RECORDING_TIMESTAMP.get(),
                    NO_SPEAKER_DETECTED_TIMESTAMP.get(),
                )
                this.log('[waiting for end meeting] meeting not ended')
                await sleep(1_000)
            }
        }
    }

    public async stopRecording(reason: string) {
        if (MeetingHandle.status.state !== 'Recording') {
            this.error(
                `Can't exit meeting, the meeting is not in recording state`,
                { status: MeetingHandle.status.state, exit_reason: reason },
            )
            return
        }
        MeetingHandle.status.state = 'Cleanup'
        this.log(`Stop recording scheduled`, {
            exit_reason: reason,
        })
    }

    private async stopRecordingInternal() {
        let { page, meetingTimeoutInterval, browser, backgroundPage } =
            this.meeting
        this.log('before stopMediaRecorder')
        await backgroundPage!.evaluate(async () => {
            const w = window as any
            await w.stopMediaRecorder()
        })

        // add a last fake speaker to trigger the upload of the last editor ( generates an interval )
        await uploadTranscriptTask(
            {
                name: 'END',
                id: 0,
                timestamp: Date.now(),
                isSpeaking: false,
            } as SpeakerData,
            true,
        )
        this.log('after stopMediaRecorder')
        try {
            await page!.goto('about:blank')
        } catch (e) {
            this.error(e)
        }

        try {
            clearTimeout(meetingTimeoutInterval!)
        } catch (e) {
            this.error(e)
        }
        try {
            await page!.close()
        } catch (e) {
            this.error(`Failed to close page: ${e}`)
        }

        this.log('before waitForUpload')
        await backgroundPage!.evaluate(async () => {
            const w = window as any
            await w.waitForUpload()
        })
        this.log('after waitForUpload')
        try {
            removeListenPage(backgroundPage!)
            await backgroundPage!.close()
            await sleep(1)
            await browser!.close()
        } catch (e) {
            this.error(`Failed to close browser: ${e}`)
        }
        this.log('Meeting successfully terminated')
    }

    private meetingTimeout() {
        this.log('stopping meeting timeout reason')
        try {
            this.stopRecording('timeout')
        } catch (e) {
            this.error(e)
        }
        setTimeout(async () => {
            this.log('killing process')
            //TODO : appeler clean everything
            try {
                await Logger.instance
                    .upload_log
                    // this.param.user_id,
                    // this.param.email,
                    // this.param.bot_uuid,
                    ()
            } catch (e) {
                this.error(e)
            }
            process.exit(0)
        }, MAX_TIME_TO_LIVE_AFTER_TIMEOUT * 1000)
    }
}
