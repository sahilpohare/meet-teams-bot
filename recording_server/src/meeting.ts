import { BrandingHandle, generateBranding, playBranding } from './branding'
import { getCachedExtensionId, listenPage, openBrowser } from './browser'
import { LOCAL_RECORDING_SERVER_LOCATION, delSessionInRedis } from './instance'
import { SoundContext, VideoContext } from './media_context'
import {
    CancellationToken,
    MeetingParams,
    MeetingProvider,
    MeetingProviderInterface,
    MeetingStatus,
    SpeakerData
} from './types'


// import { Browser as PuppeteerBrowser, Page as PuppeteerPage } from 'puppeteer'
import { Page as PlaywrightPage } from 'playwright'
import { Events } from './events'
import { Logger } from './logger'
import { MeetProvider } from './meeting/meet'
import { TeamsProvider } from './meeting/teams'
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
const RECORDING_TIMEOUT = 3600 * 4 * 1000 // 4 hours

const CHUNK_DURATION: number = 10_000 // 10 seconds for each chunks
const TRANSCRIBE_DURATION: number = CHUNK_DURATION * 18 // 3 minutes for each transcribe

const MAX_RETRIES = 3

const FIND_END_MEETING_SLEEP = 250

export class JoinError extends Error {
    details?: any;

    constructor(message: string, details?: any) {
        super(message);
        this.name = 'JoinError';
        this.details = details;
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
    private playwrightPage: PlaywrightPage
    private backgroundPage: PlaywrightPage
    private browserContext: any
    private meetingTimeoutInterval: NodeJS.Timeout | null
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
        await MeetingHandle.instance.backgroundPage!.evaluate(() => {
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
            } else {
                return new MeetProvider()
            }
        }
        console.log(
            '************ meetingParams meeting_url!!!',
            meetingParams.meeting_url,
        )
        this.provider = newMeetingProvider(meetingParams.meetingProvider)
        this.param = meetingParams
        this.browserContext = null
        this.playwrightPage = null
        this.backgroundPage = null
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

        try {
            console.log('=== INITIALIZATION CHECK ===')
            console.log('Checking provider initialization:', {
                providerExists: !!this.provider,
                providerType: this.provider?.constructor.name,
                paramsExist: !!this.param,
                meetingUrl: this.param?.meeting_url
            })

            if (!this.provider || !this.param) {
                console.error('Critical initialization error:', {
                    provider: !!this.provider,
                    params: !!this.param
                })
                throw new JoinError('InitializationError')
            }

            console.log('=== PARAMETERS VALIDATION ===')
            console.log('Meeting parameters:', {
                meetingUrl: this.param.meeting_url,
                botName: this.param.bot_name,
                recordingMode: this.param.recording_mode,
                hasBranding: !!this.param.bot_branding,
                hasStreamingInput: !!this.param.streaming_input
            })

            // Validate required parameters
            if (!this.param.meeting_url) {
                console.error('Missing meeting URL')
                throw new JoinError('MissingMeetingUrl')
            }

            if (!this.param.bot_name) {
                console.error('Missing bot name')
                throw new JoinError('MissingBotName')
            }

            try {
                // Validate meeting URL format
                new URL(this.param.meeting_url)
            } catch (e) {
                console.error('Invalid meeting URL format:', this.param.meeting_url)
                throw new JoinError('InvalidMeetingUrl')
            }

            console.log('=== Starting startRecordMeeting ===', {
                maxRetries,
                meetingUrl: this.param.meeting_url,
                provider: this.param.meetingProvider,
                botName: this.param.bot_name
            })

            // Étape 1: Setup initial (branding)
            console.log('=== Step 1: Initial Setup ===')
            if (this.param.bot_branding) {
                console.log('Starting branding generation...', {
                    botName: this.param.bot_name,
                    brandingPath: this.param.custom_branding_bot_path
                })
                this.brandingGenerateProcess = generateBranding(
                    this.param.bot_name,
                    this.param.custom_branding_bot_path,
                )
                await this.brandingGenerateProcess.wait
                console.log('Branding generation completed')
                playBranding()
            }

            // Étape 2: Setup du browser
            console.log('=== Step 2: Browser Setup ===')
            console.log('Fetching extension ID...')
            const extensionId = await getCachedExtensionId()
            console.log('Extension ID retrieved:', extensionId)
            
            console.log('Opening browser...')
            const { browser, backgroundPage } = await openBrowser(
                extensionId,
                false,
                false,
            ).catch(error => {
                console.error('Failed to open browser:', {
                    error,
                    stack: error.stack
                })
                throw error
            })
            console.log('Browser opened successfully')
            
            this.browserContext = browser
            this.backgroundPage = backgroundPage

            // Étape 3: Récupération des infos de la réunion
            console.log('=== Step 3: Meeting Info Retrieval ===')
            console.log('Parsing meeting URL:', this.param.meeting_url)
            const { meetingId, password } = await this.provider.parseMeetingUrl(
                this.browserContext,
                this.param.meeting_url,
            ).catch(error => {
                console.error('Failed to parse meeting URL:', {
                    error,
                    stack: error.stack
                })
                throw error
            })
            console.log('Meeting info parsed:', { meetingId, hasPassword: !!password })

            const meetingLink = this.provider.getMeetingLink(
                meetingId,
                password,
                0,
                this.param.bot_name,
                this.param.enter_message,
            )
            console.log('Meeting link generated:', meetingLink)

            async function handleWaitingRoom(
                page: PlaywrightPage,
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

            // boucle de retry de startRecordMeeting
            console.log('=== Starting join attempts ===')
            for (let attempt = 0; attempt < maxRetries && !joinSuccess; attempt++) {
                try {
                    console.log(`Starting attempt ${attempt + 1}/${maxRetries}`)
                    
                    console.log('Opening meeting page...')
                    this.playwrightPage = await this.provider.openMeetingPage(
                        this.browserContext,
                        this.param.meeting_url,
                        this.param.streaming_input,
                    ).catch(error => {
                        console.error('Failed to open meeting page:', {
                            error,
                            stack: error.stack
                        })
                        throw error
                    })
                    console.log('Meeting page opened successfully')

                    // Configuration du timeout
                    console.log(`Setting meeting timeout to ${RECORDING_TIMEOUT}ms`)
                    this.meetingTimeoutInterval = setTimeout(() => {
                        console.log('Meeting timeout triggered')
                        MeetingHandle.instance?.meetingTimeout()
                    }, RECORDING_TIMEOUT)

                    Events.inWaitingRoom()
                    console.log('Entering waiting room...')

                    try {
                        await handleWaitingRoom(
                            this.playwrightPage,
                            this.provider,
                            this.param,
                        )
                        console.log('Successfully joined meeting!')
                        joinSuccess = true
                    } catch (error) {
                        console.error('Waiting room error:', {
                            message: (error as Error).message,
                            stack: (error as Error).stack,
                            name: (error as Error).name,
                            isJoinError: error instanceof JoinError,
                            details: error
                        })

                        if (error instanceof JoinError) {
                            if (
                                error.message === JoinErrorCode.BotNotAccepted ||
                                error.message === JoinErrorCode.TimeoutWaitingToStart
                            ) {
                                console.log(`Critical join error: ${error.message}`)
                                MeetingHandle.status.state = 'Cleanup'
                                await this.cleanEverything()
                                throw error
                            }
                        }

                        console.log('Cleaning up failed attempt...')
                        clearTimeout(this.meetingTimeoutInterval)

                        // if (this.playwrightPage) {
                        //     console.log('Closing playwright page...')
                        //     await this.playwrightPage.close()
                        //         .catch(e => console.error('Error closing page:', e))
                        // }

                        if (attempt === maxRetries - 1) {
                            console.error('Max retries reached, initiating final cleanup')
                            await this.cleanEverything()
                            throw error
                        }

                        console.log(`Waiting before retry ${attempt + 1}/${maxRetries}`)
                        await sleep(2000)
                    }
                } catch (error) {
                    console.error(`Attempt ${attempt + 1} failed with error:`, {
                        message: (error as Error).message,
                        stack: (error as Error).stack,  
                        name: (error as Error).name,
                        details: error
                    })

                    clearTimeout(this.meetingTimeoutInterval)

                    if (error instanceof JoinError) {
                        throw error
                    }

                    if (attempt === maxRetries - 1) {
                        await this.cleanEverything()
                        throw new JoinError(JoinErrorCode.Internal)
                    }
                }
            }

            if (!joinSuccess) {
                throw new JoinError(JoinErrorCode.Internal)
            }

            // Étape 5: Setup de l'enregistrement
            listenPage(this.backgroundPage)

            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                    reject(
                        new Error(
                            'Timeout: Recording sequence took more than 30 seconds',
                        ),
                    )
                }, 30000)
            })

            const recordingSequence = async () => {
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
                try {
                    await WordsPoster.init(this.param)
                } catch (e) {
                    console.error(`Cannot start Transcriber: ${e}`)
                }

                // Nettoyage du HTML
                await this.backgroundPage.evaluate(
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
                let result: string | number = await this.backgroundPage.evaluate(
                    async (params) => {
                        try {
                            const w = window as any
                            let res = await w.startRecording(
                                params.local_recording_server_location,
                                params.chunk_duration,
                                params.streaming_output,
                                params.streaming_audio_frequency,
                            )
                            return res as number
                        } catch (error) {
                            console.error(error)
                            return error as string
                        }
                    },
                    {
                        local_recording_server_location: this.param.local_recording_server_location,
                        chunk_duration: CHUNK_DURATION,
                        streaming_output: this.param.streaming_output,
                        streaming_audio_frequency: this.param.streaming_audio_frequency,
                    }
                )

                if (typeof result === 'number') {
                    console.info(`START_RECORDING_TIMESTAMP = ${result}`)
                    START_RECORDING_TIMESTAMP.set(result)
                } else {
                    console.error(`Unexpected error: ${result}`)
                    throw new JoinError(JoinErrorCode.Internal)
                }

                // Démarrage de l'observation des speakers
                await this.backgroundPage.evaluate(
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
            }

            try {
                await Promise.race([recordingSequence(), timeoutPromise])
            } catch (error) {
                await new Promise((resolve) => setTimeout(resolve, 2000))
                await this.cleanEverything()
                MeetingHandle.status.error = error
                throw new JoinError(JoinErrorCode.Internal)
            }
        } catch (error) {
            console.error('Fatal error in startRecordMeeting:', {
                error,
                errorType: error.constructor.name,
                message: (error as Error).message,
                stack: (error as Error).stack,
                params: {
                    meetingUrl: this.param?.meeting_url,
                    botName: this.param?.bot_name,
                    providerExists: !!this.provider
                }
            })

            // Ensure proper cleanup
            try {
                await this.cleanEverything()
            } catch (cleanupError) {
                console.error('Error during cleanup:', cleanupError)
            }

            // Convert unknown errors to JoinError
            if (!(error instanceof JoinError)) {
                throw new JoinError(
                    (error as Error).message || 'InternalError',
                    { originalError: error }
                )
            }
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
            await this.playwrightPage?.close()
        } catch (e) {}
        try {
            await this.backgroundPage?.close()
        } catch (e) {}
        try {
            await this.browserContext?.close()
        } catch (e) {}
        try {
            clearTimeout(this.meetingTimeoutInterval!)
        } catch (e) {}
    }

    public async recordMeetingToEnd() {
        console.log('[recordMeetingToEnd]')
        await this.waitForEndMeeting()

        console.log('after waitForEndMeeting')
        await MeetingHandle.stopAudioStreaming()

        await this.stopRecordingInternal().catch((e) => {
            console.error(`Failed to stop recording: ${e}`)
        })

        console.log('before cleanEverything')
        await this.cleanEverything()
        console.log('after cleanEverything')

        // Retourner false si le meeting s'est terminé à cause d'une erreur
        return !MeetingHandle.status.error
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
                        this.playwrightPage!,
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

                // Si WordsPoster est initialisé, on gère ses erreurs ici
                if (WordsPoster.TRANSCRIBER) {
                    try {
                        // Vérifier l'état de la transcription si nécessaire
                        // Mais ne pas arrêter le meeting en cas d'erreur
                    } catch (error) {
                        console.error('Transcription error:', error)
                        // On continue le meeting même si la transcription échoue
                    }
                }

                await sleep(FIND_END_MEETING_SLEEP)
            }
        }
    }

    public async stopRecording(reason: string) {
        console.log('stopRecording called', {
            currentState: MeetingHandle.status.state,
            reason,
        })

        MeetingHandle.status.state = 'Cleanup'
        console.log(`Stop recording scheduled`, {
            exit_reason: reason,
            newState: MeetingHandle.status.state,
        })

        // Ajout d'une propriété pour tracker la raison de l'arrêt
        MeetingHandle.status.error =
            reason === 'Bot removed'
                ? new Error('Meeting failed to start recording properly')
                : null

        await this.stopRecordingInternal().catch((e) => {
            console.error(`Failed to stop recording: ${e}`)
        })

        await this.cleanEverything()
    }

    private async stopRecordingInternal() {
        try {
            console.log('Starting recording shutdown sequence...')

            // Étape 1: Arrêter le media recorder et attendre son dernier chunk
            console.log('Step 1: Stopping media recorder...')
            let lastChunkProcessed = false
            try {
                if (this.backgroundPage) {
                    await this.backgroundPage.evaluate(() =>
                        (window as any).stopMediaRecorder?.(),
                    )
                    // Attendre que le dernier chunk soit traité naturellement
                    await new Promise((resolve) => setTimeout(resolve, 2000))
                    lastChunkProcessed = true
                }
            } catch (e) {
                console.error('stopMediaRecorder error:', e)
            }

            // Étape 2: S'assurer que tout est bien terminé avec un chunk vide si nécessaire
            if (TRANSCODER && !lastChunkProcessed) {
                console.log('Step 2: Sending final empty chunk to transcoder...')
                await TRANSCODER.uploadChunk(Buffer.alloc(0), true)
            }

            // Étape 3: Kill brutal du navigateur
            console.log('Step 3: Force closing browser...')
            try {
                if (this.browserContext) {
                    await this.browserContext.close()
                }
            } catch (e) {
                console.error('Browser kill error:', e)
            }

            // Étape 4: Attendre que le transcoder termine son traitement
            console.log('Step 4: Stopping transcoder and uploading video...')
            if (TRANSCODER) {
                await TRANSCODER.stop()
            }

            // Étape 5: Attendre que WordsPoster finisse de traiter sa queue
            console.log('Step 5: Waiting for WordsPoster to finish...')
            try {
                if (WordsPoster.TRANSCRIBER) {
                    await WordsPoster.TRANSCRIBER.stop()
                }
            } catch (error) {
                console.error('Error stopping WordsPoster:', error)
            }

            // Étape 6: Upload de la dernière transcription
            console.log('Step 6: Uploading final transcript...')
            if (WordsPoster.TRANSCRIBER) {
                await uploadTranscriptTask(
                    {
                        name: 'END',
                        id: 0,
                        timestamp: Date.now(),
                        isSpeaking: false,
                    } as SpeakerData,
                    true,
                )
            }

            if (this.meetingTimeoutInterval) {
                clearTimeout(this.meetingTimeoutInterval)
            }
            console.log('Meeting terminated successfully')
        } catch (error) {
            console.error('Fatal error during stopRecordingInternal:', error)
            throw error
        }
    }

    private async meetingTimeout() {
        console.log('Meeting timeout reached, initiating shutdown...')
        MeetingHandle.status.state = 'Cleanup'
        await this.recordMeetingToEnd()
    }

    // Ajout d'une méthode helper pour la validation
    private validateParameters() {
        const requiredParams = {
            meeting_url: this.param.meeting_url,
            bot_name: this.param.bot_name,
            recording_mode: this.param.recording_mode
        }

        const missingParams = Object.entries(requiredParams)
            .filter(([_, value]) => !value)
            .map(([key]) => key)

        if (missingParams.length > 0) {
            console.error('Missing required parameters:', missingParams)
            throw new JoinError(`MissingParameters: ${missingParams.join(', ')}`)
        }
    }
}
