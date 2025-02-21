import { Events } from '../../events'
import { TRANSCODER } from '../../transcoder'
import { WordsPoster } from '../../words_poster/words_poster'
import { MEETING_CONSTANTS } from '../constants'
import { MeetingStateType, StateExecuteResult } from '../types'
import { BaseState } from './base-state'

export class InCallState extends BaseState {
    async execute(): StateExecuteResult {
        try {
            // Démarrer avec un timeout global pour le setup
            await Promise.race([this.setupRecording(), this.createTimeout()])

            return this.transition(MeetingStateType.Recording)
        } catch (error) {
            console.error('Setup recording failed:', error)
            return this.handleError(error as Error)
        }
    }

    private createTimeout(): Promise<never> {
        return new Promise((_, reject) => {
            setTimeout(() => {
                reject(
                    new Error(
                        'Setup timeout: Recording sequence took too long',
                    ),
                )
            }, MEETING_CONSTANTS.SETUP_TIMEOUT)
        })
    }

    private async setupRecording(): Promise<void> {
        try {
            console.info('Starting recording setup sequence')

            // Notifier qu'on est en appel mais pas encore en enregistrement
            await Events.inCallNotRecording()

            // Initialiser le transcoder
            await this.initializeTranscoder()

            // Initialiser le WordPoster
            await this.initializeWordPoster()

            // Nettoyer le HTML
            await this.cleanupHtml()

            // Démarrer l'observation des speakers AVANT l'enregistrement
            await this.startSpeakersObserver()

            // Démarrer l'enregistrement en dernier
            await this.startRecordingAndSetTimestamp()

            // Notifier que l'enregistrement est démarré
            await Events.inCallRecording()

            console.info('Recording setup completed successfully')
        } catch (error) {
            console.error('Failed during recording setup:', error)
            throw error
        }
    }

    private async startRecordingAndSetTimestamp(): Promise<void> {
        console.info('Starting recording')
        if (!this.context.backgroundPage) {
            throw new Error('Background page not initialized')
        }

        // On démarre l'enregistrement et on attend la confirmation
        await this.context.backgroundPage.evaluate(
            async (params) => {
                const w = window as any
                return await w.startRecording(
                    params.local_recording_server_location,
                    params.chunk_duration,
                    params.streaming_output,
                    params.streaming_audio_frequency,
                )
            },
            {
                local_recording_server_location:
                    this.context.params.local_recording_server_location,
                chunk_duration: MEETING_CONSTANTS.CHUNK_DURATION,
                streaming_output: this.context.params.streaming_output,
                streaming_audio_frequency:
                    this.context.params.streaming_audio_frequency,
            },
        )

        // Une fois que l'enregistrement est confirmé comme démarré, on prend le timestamp
        this.context.startTime = Date.now()
        console.info(
            `Recording started at timestamp: ${this.context.startTime}`,
        )
    }

    private async initializeTranscoder(): Promise<void> {
        console.info('Initializing transcoder')
        await TRANSCODER.init(
            process.env.AWS_S3_VIDEO_BUCKET,
            this.context.params.mp4_s3_path,
            MEETING_CONSTANTS.CHUNK_DURATION,
            MEETING_CONSTANTS.TRANSCRIBE_DURATION,
        )
    }

    private async initializeWordPoster(): Promise<void> {
        console.info('Initializing WordPoster')
        await WordsPoster.init(this.context.params)
    }

    private async cleanupHtml(): Promise<void> {
        console.info('Cleaning up HTML')
        if (!this.context.backgroundPage) {
            throw new Error('Background page not initialized')
        }

        await this.context.backgroundPage.evaluate(
            async (params) => {
                const w = window as any
                await w.remove_shitty_html(
                    params.recording_mode,
                    params.meetingProvider,
                )
            },
            {
                recording_mode: this.context.params.recording_mode,
                meetingProvider: this.context.params.meetingProvider,
            },
        )
    }

    private async startRecording(): Promise<number> {
        console.info('Starting recording')
        if (!this.context.backgroundPage) {
            throw new Error('Background page not initialized')
        }

        const result = await this.context.backgroundPage.evaluate(
            async (params) => {
                const w = window as any
                return await w.startRecording(
                    params.local_recording_server_location,
                    params.chunk_duration,
                    params.streaming_output,
                    params.streaming_audio_frequency,
                )
            },
            {
                local_recording_server_location:
                    this.context.params.local_recording_server_location,
                chunk_duration: MEETING_CONSTANTS.CHUNK_DURATION,
                streaming_output: this.context.params.streaming_output,
                streaming_audio_frequency:
                    this.context.params.streaming_audio_frequency,
            },
        )

        if (typeof result !== 'number') {
            throw new Error(`Failed to start recording: ${result}`)
        }

        return result
    }

    private async startSpeakersObserver(): Promise<void> {
        console.info('Starting speakers observer')
        if (!this.context.backgroundPage) {
            throw new Error('Background page not initialized')
        }

        await this.context.backgroundPage.evaluate(
            async (params) => {
                const w = window as any
                await w.start_speakers_observer(
                    params.recording_mode,
                    params.bot_name,
                    params.meetingProvider,
                )
            },
            {
                recording_mode: this.context.params.recording_mode,
                bot_name: this.context.params.bot_name,
                meetingProvider: this.context.params.meetingProvider,
            },
        )
    }
}
