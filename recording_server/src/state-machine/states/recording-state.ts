import { Events } from '../../events'
import { MEETING_CONSTANTS } from '../constants'

import {
    MeetingStateType,
    RecordingEndReason,
    StateExecuteResult,
} from '../types'
import { BaseState } from './base-state'

import { TRANSCODER } from '../../recording/Transcoder'
import { PathManager } from '../../utils/PathManager'

export class RecordingState extends BaseState {
    private isProcessing: boolean = true
    private pathManager: PathManager
    private readonly CHECK_INTERVAL = 250

    async execute(): StateExecuteResult {
        try {
            console.info('Starting recording state')

            // Initialiser PathManager
            this.pathManager = PathManager.getInstance(
                this.context.params.bot_uuid,
            )
            await this.pathManager.initializePaths()

            // Initialiser l'enregistrement
            await this.initializeRecording()

            // Définir un timeout global pour l'état d'enregistrement
            const startTime = Date.now()

            // Boucle principale
            while (this.isProcessing) {
                // Vérifier le timeout global
                if (
                    Date.now() - startTime >
                    MEETING_CONSTANTS.RECORDING_TIMEOUT
                ) {
                    console.warn(
                        'Global recording state timeout reached, forcing end',
                    )
                    await this.handleMeetingEnd(
                        RecordingEndReason.RecordingTimeout,
                    )
                    break
                }

                // Vérifier si on doit s'arrêter
                const { shouldEnd, reason } = await this.checkEndConditions()

                if (shouldEnd) {
                    console.info(`Meeting end condition met: ${reason}`)
                    await this.handleMeetingEnd(reason)
                    break
                }

                // Si pause demandée, transitionner vers l'état Paused
                if (this.context.isPaused) {
                    return this.transition(MeetingStateType.Paused)
                }

                await this.sleep(this.CHECK_INTERVAL)
            }

            return this.transition(MeetingStateType.Cleanup)
        } catch (error) {
            console.error('Error in recording state:', error)
            return this.handleError(error as Error)
        }
    }

    private async initializeRecording(): Promise<void> {
        console.info('Initializing recording...')

        // Vérifier que les services sont bien initialisés
        if (!this.context.transcriptionService) {
            console.error('TranscriptionService missing from context')
            throw new Error('TranscriptionService not initialized')
        }

        // Démarrer le streaming si disponible
        if (this.context.streamingService) {
            this.context.streamingService.start()
        }

        // Log l'état du contexte
        console.info('Context state:', {
            hasTranscriptionService: !!this.context.transcriptionService,
            hasPathManager: !!this.context.pathManager,
            hasStreamingService: !!this.context.streamingService,
            isTranscoderConfigured: TRANSCODER.getStatus().isConfigured,
        })

        // Configurer les listeners
        await this.setupEventListeners()
        console.info('Recording initialized successfully')
    }

    private async setupEventListeners(): Promise<void> {
        console.info('Setting up event listeners...')

        TRANSCODER.on('chunkProcessed', async (chunkInfo) => {
            try {
                console.info('Received chunk for transcription:', {
                    startTime: chunkInfo.startTime,
                    endTime: chunkInfo.endTime,
                    hasAudioUrl: !!chunkInfo.audioUrl,
                })

                await this.context.transcriptionService?.transcribeSegment(
                    chunkInfo.startTime,
                    chunkInfo.endTime,
                    chunkInfo.audioUrl,
                )
            } catch (error) {
                console.error('Error during transcription:', error)
            }
        })

        TRANSCODER.on('error', async (error) => {
            console.error('Recording error:', error)
            this.context.error = error
            this.isProcessing = false
        })

        this.context.transcriptionService?.on(
            'transcriptionComplete',
            (result) => {
                console.info('Transcription complete:', {
                    hasResults: result.results.length > 0,
                })
                if (result.results.length > 0) {
                    this.context.lastSpeakerTime = Date.now()
                }
            },
        )

        console.info('Event listeners setup complete')
    }

    private async checkEndConditions(): Promise<{
        shouldEnd: boolean
        reason?: RecordingEndReason
    }> {
        const checkPromise = async () => {
            const now = Date.now()

            try {
                // On vérifie si un arrêt a été demandé via la machine d'état
                if (this.context.endReason) {
                    return { shouldEnd: true, reason: this.context.endReason }
                }

                // Vérifier si le bot a été retiré
                if (await this.checkBotRemoved()) {
                    return {
                        shouldEnd: true,
                        reason: RecordingEndReason.BotRemoved,
                    }
                }

                // Vérifier les participants
                if (await this.checkNoAttendees(now)) {
                    return {
                        shouldEnd: true,
                        reason: RecordingEndReason.NoAttendees,
                    }
                }

                // Vérifier l'activité audio
                if (await this.checkNoSpeaker(now)) {
                    return {
                        shouldEnd: true,
                        reason: RecordingEndReason.NoSpeaker,
                    }
                }

                return { shouldEnd: false }
            } catch (error) {
                console.error('Error checking end conditions:', error)
                return {
                    shouldEnd: true,
                    reason: RecordingEndReason.ApiRequest,
                }
            }
        }

        const timeoutPromise = new Promise<{
            shouldEnd: boolean
            reason?: RecordingEndReason
        }>((_, reject) =>
            setTimeout(
                () => reject(new Error('Check end conditions timeout')),
                5000,
            ),
        )

        try {
            return await Promise.race([checkPromise(), timeoutPromise])
        } catch (error) {
            console.error('Error or timeout in checkEndConditions:', error)
            return { shouldEnd: true, reason: RecordingEndReason.ApiRequest }
        }
    }

    private async handleMeetingEnd(reason: RecordingEndReason): Promise<void> {
        try {
            this.context.endReason = reason
            this.context.provider.closeMeeting(this.context.playwrightPage)
            Events.callEnded()
            
            // Arrêter dans l'ordre correct
            await this.stopVideoRecording()
            await this.stopAudioStreaming()

            // Ajouter l'arrêt du Transcoder ici avec gestion d'erreur
            try {
                await TRANSCODER.stop()
            } catch (error) {
                console.error('Error stopping transcoder, continuing cleanup:', error)
                // Ne pas propager cette erreur pour permettre au nettoyage de continuer
            }

            await this.sleep(2000)
            this.isProcessing = false
        } catch (error) {
            console.error('Error during meeting end:', error)
            throw error
        }
    }

    private async stopVideoRecording(): Promise<void> {
        if (!this.context.backgroundPage) {
            console.error(
                'Background page not available for stopping video recording',
            )
            return
        }

        try {
            // 1. Arrêter l'enregistrement média
            await this.context.backgroundPage.evaluate(() => {
                const w = window as any
                return w.stopMediaRecorder()
            })
        } catch (error) {
            console.error('Failed to stop video recording:', error)
            throw error
        }
    }

    private async stopAudioStreaming(): Promise<void> {
        if (!this.context.backgroundPage) {
            console.error('Background page not available for stopping audio')
            return
        }

        try {
            await this.context.backgroundPage.evaluate(() => {
                const w = window as any
                return w.stopAudioStreaming()
            })
            console.info('Audio streaming stopped successfully')
        } catch (error) {
            console.error('Failed to stop audio streaming:', error)
            throw error
        }
    }

    private async checkBotRemoved(): Promise<boolean> {
        if (!this.context.playwrightPage) {
            console.error('Playwright page not available')
            return true
        }

        try {
            return await this.context.provider.findEndMeeting(
                this.context.params,
                this.context.playwrightPage,
            )
        } catch (error) {
            console.error('Error checking if bot was removed:', error)
            return false
        }
    }

    /**
     * Vérifie si le meeting doit se terminer à cause d'un manque de participants
     * @param now Timestamp actuel
     * @returns true si le meeting doit se terminer par manque de participants
     */
    private checkNoAttendees(now: number): boolean {
        const attendeesCount = this.context.attendeesCount || 0
        const startTime = this.context.startTime || 0
        const firstUserJoined = this.context.firstUserJoined || false

        // Si des participants sont présents, pas besoin de terminer
        if (attendeesCount > 0) {
            return false
        }

        // Vrai si on a dépassé les 7 minutes initiales sans aucun participant
        const noAttendeesTimeout =
            startTime + MEETING_CONSTANTS.INITIAL_WAIT_TIME < now

        // Vrai si au moins un utilisateur a rejoint puis est parti
        const noAttendeesAfterJoin = firstUserJoined

        // On termine si personne n'est présent ET
        // soit on a dépassé le timeout initial, soit quelqu'un était là mais est parti
        return noAttendeesTimeout || noAttendeesAfterJoin
    }

    /**
     * Vérifie si le meeting doit se terminer à cause d'une absence de son
     * @param now Timestamp actuel
     * @returns true si le meeting doit se terminer par absence de son
     */
    private checkNoSpeaker(now: number): boolean {
        const noSpeakerDetectedTime = this.context.noSpeakerDetectedTime || 0

        // Si aucune période de silence n'a été détectée, pas besoin de terminer
        if (noSpeakerDetectedTime <= 0) {
            return false
        }

        // Vérifier si la période de silence a dépassé le timeout
        return noSpeakerDetectedTime + MEETING_CONSTANTS.SILENCE_TIMEOUT < now
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms))
    }
}
