import { Events } from '../../events'
import { TRANSCODER } from '../../recording/Transcoder'
import { SpeakerManager } from '../../speaker-manager'
import { TranscriptionService } from '../../transcription/TranscriptionService'
import { WordsPoster } from '../../transcription/WordPoster'
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
            Events.inCallNotRecording()

            // Initialiser les services
            await this.initializeServices()

            // Nettoyer le HTML et démarrer l'observation
            await this.setupBrowserComponents()

            console.info('Recording setup completed successfully')
        } catch (error) {
            console.error('Failed during recording setup:', error)
            throw error
        }
    }


    private async initializeServices(): Promise<void> {
        console.info('Initializing services');
    
        if (!this.context.pathManager) {
            throw new Error('PathManager not initialized');
        }
    
        // Créer le WordsPoster
        const wordsPoster = new WordsPoster();
        console.log("CONTEXT PARAMS", this.context.params);
        
        // Initialiser le service de transcription avec le WordsPoster
        this.context.transcriptionService = new TranscriptionService(
            this.context.params.speech_to_text_provider || 'Default',
            this.context.params.speech_to_text_api_key,
            {}, // options
            wordsPoster // passer le WordsPoster ici
        );
    
        // Configurer le transcoder avec le mode d'enregistrement
        TRANSCODER.configure(
            this.context.pathManager,
            this.context.transcriptionService,
            this.context.params.recording_mode
        );
    
        await TRANSCODER.start();
        
        console.info('Services initialized successfully');
    }
    
    private async setupBrowserComponents(): Promise<void> {
        if (!this.context.backgroundPage) {
            throw new Error('Background page not initialized')
        }

        // Nettoyage du HTML
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

       SpeakerManager.start()

        // Démarrer l'observation des speakers
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

        // Démarrer l'enregistrement
        const startTime = await this.context.backgroundPage.evaluate(
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

        // Enregistrer le timestamp de début
        this.context.startTime = startTime
        console.info(`Recording started at timestamp: ${startTime}`)

        // Notifier que l'enregistrement est démarré avec le startTime
        Events.inCallRecording({ start_time: startTime })
    }
}
