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

        // Démarrer le streaming si disponible
        if (this.context.streamingService) {
            this.context.streamingService.start()
        }

        // Log l'état du contexte
        console.info('Context state:', {
           
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

        
            } catch (error) {
                console.error('Error during transcription:', error)
            }
        })

        TRANSCODER.on('error', async (error) => {
            console.error('Recording error:', error)
            this.context.error = error
            this.isProcessing = false
        })

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
                    reason: RecordingEndReason.BotRemoved,
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
            return { shouldEnd: true, reason: RecordingEndReason.BotRemoved }
        }
    }

    private async handleMeetingEnd(reason: RecordingEndReason): Promise<void> {
        console.info(`Handling meeting end with reason: ${reason}`)
        this.context.endReason = reason
        
        try {
            // Essayer de fermer la réunion mais ne pas laisser une erreur ici affecter le reste
            try {
                // If the reason is bot_removed, we know the meeting is already effectively closed
                if (reason === RecordingEndReason.BotRemoved) {
                    console.info('Bot was removed from meeting, skipping active closure step')
                } else {
                    await this.context.provider.closeMeeting(this.context.playwrightPage)
                }
            } catch (closeError) {
                console.error('Error closing meeting, but continuing process:', closeError)
            }
            
            // These critical steps must execute regardless of previous steps
            console.info('Triggering call ended event')
            await Events.callEnded()
            
            console.info('Stopping video recording')
            await this.stopVideoRecording().catch(err => {
                console.error('Error stopping video recording, continuing:', err)
            })
            
            console.info('Stopping audio streaming')
            await this.stopAudioStreaming().catch(err => {
                console.error('Error stopping audio streaming, continuing:', err) 
            })

            console.info('Stopping transcoder')
            try {
                await TRANSCODER.stop()
            } catch (error) {
                console.error('Error stopping transcoder, continuing cleanup:', error)
            }

            console.info('Setting isProcessing to false to end recording loop')
            await this.sleep(2000)
        } catch (error) {
            console.error('Error during meeting end handling:', error)
        } finally {
            // Always ensure this flag is set to stop the processing loop
            this.isProcessing = false
            console.info('Meeting end handling completed')
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
            // Vérifier si la fonction existe d'abord
            const functionExists = await this.context.backgroundPage.evaluate(() => {
                const w = window as any;
                return {
                    stopMediaRecorderExists: typeof w.stopMediaRecorder === 'function',
                    recordExists: typeof w.record !== 'undefined',
                    recordStopExists: w.record && typeof w.record.stop === 'function'
                };
            });
            
            console.log('Stop functions status:', functionExists);
            
            if (functionExists.stopMediaRecorderExists) {
                // 1. Arrêter l'enregistrement média avec diagnostic détaillé
                await this.context.backgroundPage.evaluate(() => {
                    const w = window as any;
                    try {
                        console.log('Calling stopMediaRecorder...');
                        const result = w.stopMediaRecorder();
                        console.log('stopMediaRecorder called successfully, result:', result);
                        return result;
                    } catch (error) {
                        console.error('Error in stopMediaRecorder:', error);
                        // Essayer d'afficher plus de détails sur l'erreur
                        console.error('Error details:', 
                            JSON.stringify(error, Object.getOwnPropertyNames(error)));
                        throw error;
                    }
                });
            } else {
                console.warn('stopMediaRecorder function not found in window object');
                
                // Tentative de workaround direct avec MediaRecorder si disponible
                try {
                    await this.context.backgroundPage.evaluate(() => {
                        const w = window as any;
                        if (w.MEDIA_RECORDER && w.MEDIA_RECORDER.state !== 'inactive') {
                            console.log('Attempting direct stop of MEDIA_RECORDER');
                            w.MEDIA_RECORDER.stop();
                            return true;
                        }
                        return false;
                    });
                } catch (directStopError) {
                    console.error('Failed direct stop attempt:', directStopError);
                }
            }
        } catch (error) {
            console.error('Failed to stop video recording:', error);
            throw error;
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
