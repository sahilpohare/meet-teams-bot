import { BrandingHandle, generateBranding, playBranding } from './branding'
import { LOCAL_RECORDING_SERVER_LOCATION, delSessionInRedis } from './instance'
import { SoundContext, VideoContext } from './media_context'
import { getCachedExtensionId, listenPage, openBrowser } from './puppeteer'
import {
    CancellationToken,
    Meeting,
    MeetingParams,
    MeetingProvider,
    MeetingProviderInterface,
    MeetingStatus,
    SpeakerData,
} from './types'

import { Page } from 'puppeteer'
import { Events } from './events'
import { Logger } from './logger'
import { MeetProvider } from './meeting/meet'
import { TeamsProvider } from './meeting/teams'
import { ZoomProvider } from './meeting/zoom'
import { TRANSCODER } from './transcoder'
import { uploadTranscriptTask } from './uploadTranscripts'
import { sleep } from './utils'
import { WordsPoster } from './words_poster/words_poster'

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
const MAX_TIME_TO_LIVE_AFTER_TIMEOUT = 3600 * 2 // 2 hours

const CHUNK_DURATION: number = 10_000 // 10 seconds for each chunks
const TRANSCRIBE_DURATION: number = CHUNK_DURATION * 18 // 3 minutes for each transcribe

const MAX_RETRIES = 3

const FIND_END_MEETING_SLEEP = 250

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
        console.error = null
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
    static async stopAudioStreaming() {
        await MeetingHandle.instance.meeting.backgroundPage!.evaluate(() => {
            const w = window as any
            return w.stopAudioStreaming()
        })
    }
    constructor(meetingParams: MeetingParams) {
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

    public async startRecordMeeting(maxRetries = MAX_RETRIES) {
        let joinSuccess = false

        // Étape 1: Setup initial (branding)
        if (this.param.bot_branding) {
            this.brandingGenerateProcess = generateBranding(
                this.param.bot_name,
                this.param.custom_branding_bot_path,
            )
            await this.brandingGenerateProcess.wait
            playBranding()
        }

        try {
            // Étape 2: Setup du browser
            const extensionId = await getCachedExtensionId()
            const { browser, backgroundPage } = await openBrowser(
                extensionId,
                false,
                false,
            )
            this.meeting.browser = browser
            this.meeting.backgroundPage = backgroundPage
            console.log('Extension found', { extensionId })

            // Étape 3: Récupération des infos de la réunion
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

            async function handleWaitingRoom(
                page: Page,
                provider: MeetingProviderInterface,
                params: MeetingParams,
            ): Promise<void> {
                let timeoutHandle: NodeJS.Timeout

                const waitingRoomPromise = new Promise<void>(
                    (resolve, reject) => {
                        const timeoutInMs =
                            params.automatic_leave.waiting_room_timeout * 1000
                        console.log(
                            `Setting waiting room timeout to ${timeoutInMs}ms`,
                        )

                        timeoutHandle = setTimeout(() => {
                            reject(
                                new JoinError(
                                    JoinErrorCode.TimeoutWaitingToStart,
                                ),
                            )
                        }, timeoutInMs)

                        provider
                            .joinMeeting(
                                page,
                                () =>
                                    MeetingHandle.status.state !== 'Recording',
                                params,
                            )
                            .then(() => {
                                clearTimeout(timeoutHandle)
                                resolve()
                            })
                            .catch((error) => {
                                clearTimeout(timeoutHandle)
                                if (error instanceof JoinError) {
                                    if (
                                        error.message ===
                                        JoinErrorCode.BotNotAccepted
                                    ) {
                                        console.log(
                                            'Bot not accepted detected...',
                                        )
                                    }
                                    reject(error)
                                } else {
                                    console.error(
                                        'Join meeting failed (will retry):',
                                        error,
                                    )
                                    reject(new Error('RetryableError'))
                                }
                            })
                    },
                )

                return waitingRoomPromise
            }

            // Dans la boucle de retry de startRecordMeeting
            for (
                let attempt = 0;
                attempt < maxRetries && !joinSuccess;
                attempt++
            ) {
                try {
                    this.meeting.page = await this.provider.openMeetingPage(
                        this.meeting.browser,
                        meetingLink,
                        this.param.streaming_input,
                    )
                    console.log('meeting page opened')

                    // Configuration du timeout du meeting avant de commencer
                    this.meeting.meetingTimeoutInterval = setTimeout(() => {
                        MeetingHandle.instance?.meetingTimeout()
                    }, RECORDING_TIMEOUT * 1000)

                    Events.inWaitingRoom()

                    try {
                        await handleWaitingRoom(
                            this.meeting.page,
                            this.provider,
                            this.param,
                        )
                        joinSuccess = true
                    } catch (error) {
                        console.error(
                            `Attempt ${attempt + 1} failed with error:`,
                            error instanceof JoinError ? error.message : error,
                        )

                        if (error instanceof JoinError) {
                            if (
                                error.message === JoinErrorCode.BotNotAccepted
                            ) {
                                console.log(
                                    'Bot not accepted, initiating shutdown sequence...',
                                )
                                MeetingHandle.status.state = 'Recording'

                                await this.stopRecording('bot not accepted')
                                await this.cleanEverything()
                                throw error
                            }
                            if (
                                error.message ===
                                JoinErrorCode.TimeoutWaitingToStart
                            ) {
                                console.log(
                                    'Waiting room timeout, initiating shutdown sequence...',
                                )
                                MeetingHandle.status.state = 'Recording'
                                await this.stopRecording('waiting room timeout')
                                await this.cleanEverything()
                                throw error
                            }
                        }

                        // En cas d'erreur, nettoyer le timeout du meeting
                        clearTimeout(this.meeting.meetingTimeoutInterval)

                        if (this.meeting.page) {
                            await this.meeting.page
                                .close()
                                .catch((e) =>
                                    console.error('Error closing page:', e),
                                )
                        }

                        if (attempt === maxRetries - 1) {
                            await this.cleanEverything()
                            throw error
                        }

                        console.log(
                            `Retrying... (${attempt + 1}/${maxRetries})`,
                        )
                        await sleep(2000)
                    }
                } catch (error) {
                    // Nettoyer le timeout en cas d'erreur non gérée
                    clearTimeout(this.meeting.meetingTimeoutInterval)

                    if (error instanceof JoinError) {
                        throw error
                    }

                    console.error(
                        `Error in retry loop (attempt ${attempt + 1}):`,
                        error,
                    )
                    if (attempt === maxRetries - 1) {
                        await this.cleanEverything()
                        throw error
                    }
                }
            }

            if (!joinSuccess) {
                throw new Error('Failed to join meeting after all retries')
            }

            // Étape 5: Setup de l'enregistrement
            listenPage(this.meeting.backgroundPage)
            await Events.inCallNotRecording()

            // Démarrage du transcoder
            await TRANSCODER.init(
                process.env.AWS_S3_VIDEO_BUCKET,
                this.param.mp4_s3_path,
                CHUNK_DURATION,
                TRANSCRIBE_DURATION,
            ).catch((e) => {
                console.error(`Cannot start Transcoder: ${e}`)
            })

            // Démarrage du WordPoster
            await WordsPoster.init(this.param).catch((e) => {
                console.error(`Cannot start Transcriber: ${e}`)
            })

            // Nettoyage du HTML
            await this.meeting.backgroundPage.evaluate(
                async (params) => {
                    const w = window as any
                    await w.remove_shitty_html(
                        params.recording_mode,
                        params.meetingProvider,
                    )
                },
                {
                    recording_mode: this.param.recording_mode,
                    meetingProvider: this.param.meetingProvider,
                },
            )

            await sleep(3000)

            // Démarrage de l'enregistrement
            let result: string | number =
                await this.meeting.backgroundPage.evaluate(
                    async (meuh) => {
                        try {
                            const w = window as any
                            let res = await w.startRecording(
                                meuh.local_recording_server_location,
                                meuh.chunk_duration,
                                meuh.streaming_output,
                                meuh.streaming_audio_frequency,
                            )
                            return res as number
                        } catch (error) {
                            console.error(error)
                            return error as string
                        }
                    },
                    {
                        local_recording_server_location:
                            this.param.local_recording_server_location,
                        chunk_duration: CHUNK_DURATION,
                        streaming_output: this.param.streaming_output,
                        streaming_audio_frequency:
                            this.param.streaming_audio_frequency,
                    },
                )

            if (typeof result === 'number') {
                console.info(`START_RECORDING_TIMESTAMP = ${result}`)
                START_RECORDING_TIMESTAMP.set(result)
            } else {
                console.error(`Unexpected error: ${result}`)
                throw new JoinError(JoinErrorCode.Internal)
            }

            // Démarrage de l'observation des speakers
            await this.meeting.backgroundPage.evaluate(
                async (params) => {
                    const w = window as any
                    await w.start_speakers_observer(
                        params.recording_mode,
                        params.bot_name,
                        params.meetingProvider,
                    )
                },
                {
                    recording_mode: this.param.recording_mode,
                    bot_name: this.param.bot_name,
                    meetingProvider: this.param.meetingProvider,
                },
            )

            console.log('startRecording called')
            await Events.inCallRecording()
            return // Succès !
        } catch (error) {
            await new Promise((resolve) => setTimeout(resolve, 2000))
            await this.cleanEverything()
            MeetingHandle.status.error = error
            throw error
        }
    }

    private async cleanEverything() {
        try {
            await Logger.instance.upload_log()
        } catch (e) {
            console.error(`failed to upload logs: ${e}`)
        }
        try {
            this.brandingGenerateProcess?.kill()
            VideoContext.instance?.stop()
            SoundContext.instance?.stop()
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
        console.log('[recordMeetingToEnd]')
        await this.waitForEndMeeting()

        console.log('after waitForEndMeeting')
        await Events.callEnded()

        await MeetingHandle.stopAudioStreaming()

        await this.stopRecordingInternal().catch((e) => {
            console.error(`Failed to stop recording: ${e}`)
        })

        console.log('before cleanEverything')
        await this.cleanEverything()
        console.log('after cleanEverything')
    }

    private async waitForEndMeeting() {
        console.log('waiting for end meeting')
        const cancelationToken = new CancellationToken(
            this.param.automatic_leave.noone_joined_timeout,
        )

        while (MeetingHandle.status.state === 'Recording') {
            let now = Date.now()
            // console.log(
            //     'number of attendees',
            //     NUMBER_OF_ATTENDEES.get(),
            //     'no speaker ',
            //     NO_SPEAKER_THRESHOLD < now,
            //     'FIRST_USER_JOINED',
            //     FIRST_USER_JOINED.get(),
            // )
            if (
                await this.provider
                    .findEndMeeting(
                        this.param,
                        this.meeting.page!,
                        cancelationToken,
                    )
                    .catch((e) => {
                        console.error(`findEndMeeting crashed with error: ${e}`)
                    })
            ) {
                console.log('findEndMeeting triggered')
                await this.stopRecording('Bot removed')
            } else if (
                (NUMBER_OF_ATTENDEES.get() === 0 &&
                    START_RECORDING_TIMESTAMP.get() + NO_SPEAKER_THRESHOLD <
                        now) ||
                (NUMBER_OF_ATTENDEES.get() === 0 && FIRST_USER_JOINED.get())
            ) {
                await this.stopRecording('no attendees')
            } else if (
                START_RECORDING_TIMESTAMP.get() !== null &&
                START_RECORDING_TIMESTAMP.get() + NO_SPEAKER_THRESHOLD < now &&
                NO_SPEAKER_DETECTED_TIMESTAMP.get() !== null &&
                NO_SPEAKER_DETECTED_TIMESTAMP.get() +
                    NO_SPEAKER_DETECTED_TIMEOUT <
                    now
            ) {
                await this.stopRecording('no speaker detected timeout')
            } else {
                console.log(
                    '[waiting for end meeting] no speaker detected timestamp',
                    START_RECORDING_TIMESTAMP.get(),
                    NO_SPEAKER_DETECTED_TIMESTAMP.get(),
                )
                console.log('[waiting for end meeting] meeting not ended')
                await sleep(FIND_END_MEETING_SLEEP)
            }
        }
    }

    public async stopRecording(reason: string) {
        console.log('stopRecording called', {
            currentState: MeetingHandle.status.state,
            reason,
        })

        // On ne vérifie plus si l'état est "Recording"
        // car on peut avoir besoin d'arrêter le meeting dans d'autres états
        MeetingHandle.status.state = 'Cleanup'
        console.log(`Stop recording scheduled`, {
            exit_reason: reason,
            newState: MeetingHandle.status.state,
        })
    }

    private async stopRecordingInternal() {
        const { page, meetingTimeoutInterval, browser, backgroundPage } =
            this.meeting

        try {
            console.log('Starting recording shutdown sequence...')

            // Étape 1: Arrêter l'enregistreur et fermer les pages
            console.log('Step 1: Stopping media recorder and closing pages...')
            await Promise.all([
                browser?.process()?.kill('SIGKILL'),
                backgroundPage
                    ?.evaluate(() => (window as any).stopMediaRecorder?.())
                    .catch((e) => console.error('stopMediaRecorder error:', e)),
                page
                    ?.close()
                    .catch((e) => console.error('Page close error:', e)),
                backgroundPage
                    ?.close()
                    .catch((e) =>
                        console.error('Background page close error:', e),
                    ),
            ])

            // Étape 2: Envoyer un dernier chunk vide avec isFinal=true
            console.log('Step 2: Sending final empty chunk to transcoder...')
            await TRANSCODER.uploadChunk(Buffer.alloc(0), true).catch((e) =>
                console.error('Final chunk upload error:', e),
            )

            // Étape 3: Attendre que le transcoder termine son traitement et uploade la vidéo
            console.log('Step 3: Stopping transcoder and uploading video...')
            await TRANSCODER.stop().catch((e) =>
                console.error('TRANSCODER stop error:', e),
            )

            // Étape 4: Upload de la dernière transcription
            console.log('Step 4: Uploading final transcript...')
            await uploadTranscriptTask(
                {
                    name: 'END',
                    id: 0,
                    timestamp: Date.now(),
                    isSpeaking: false,
                } as SpeakerData,
                true,
            ).catch((e) => console.error('Upload transcript error:', e))

            // Étape 5: Arrêt du transcriber et nettoyage final
            console.log('Step 5: Final cleanup...')
            await WordsPoster.TRANSCRIBER?.stop().catch((e) =>
                console.error('TRANSCRIBER stop error:', e),
            )

            meetingTimeoutInterval && clearTimeout(meetingTimeoutInterval)
            console.log('Meeting terminated successfully')
        } catch (error) {
            console.error('Fatal error during stopRecordingInternal:', error)
            throw error
        }
    }

    private async meetingTimeout() {
        console.log('Meeting timeout reached, initiating shutdown...')
        try {
            await this.stopRecording('timeout')
            await this.cleanEverything()
        } catch (e) {
            console.error('Error during meeting timeout cleanup:', e)
        }
        // Forcer l'arrêt du processus après un délai
        setTimeout(() => {
            console.log('Force killing process after timeout...')
            process.exit(0)
        }, MAX_TIME_TO_LIVE_AFTER_TIMEOUT * 1000)
    }
}
