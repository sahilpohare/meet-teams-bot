import { Events } from '../../events';
import { TRANSCODER } from '../../recording/Transcoder';            
import { TranscriptionService } from '../../transcription/TranscriptionService';
import { MeetingStateType, StateExecuteResult } from '../types';
import { BaseState } from './base-state';

export class PausedState extends BaseState {
    private transcriptionService: TranscriptionService;

    async execute(): StateExecuteResult {
        try {
            // Récupérer le service de transcription depuis le contexte
            this.transcriptionService = this.context.transcriptionService;

            // Marquer le début de la pause
            if (!this.context.pauseStartTime) {
                this.context.pauseStartTime = Date.now();
            }

            // Sauvegarder l'état actuel
            this.context.lastRecordingState = {
                timestamp: Date.now(),
                attendeesCount: this.context.attendeesCount,
                lastSpeakerTime: this.context.lastSpeakerTime,
                noSpeakerDetectedTime: this.context.noSpeakerDetectedTime
            };

            // Pause de l'enregistrement et de la transcription
            await this.pauseRecording();

            // Notifier de la pause
            await Events.recordingPaused();

            // Attendre la demande de reprise
            while (this.context.isPaused) {
                await new Promise(resolve => setTimeout(resolve, 100));

                // Vérifier si on doit arrêter complètement
                if (this.context.endReason) {
                    return this.transition(MeetingStateType.Cleanup);
                }
            }

            // Calculer la durée de pause
            if (this.context.pauseStartTime) {
                const pauseDuration = Date.now() - this.context.pauseStartTime;
                this.context.totalPauseDuration = (this.context.totalPauseDuration || 0) + pauseDuration;
            }

            return this.transition(MeetingStateType.Resuming);
        } catch (error) {
            console.error('Error in paused state:', error);
            return this.handleError(error as Error);
        }
    }

    private async pauseRecording(): Promise<void> {
        try {
            // Pause du MediaRecorder dans le navigateur
            await this.context.backgroundPage?.evaluate(() => {
                const w = window as any;
                return w.pauseMediaRecorder?.();
            });

            // Pause du Transcoder
            await TRANSCODER.pause();

            // Pause du service de transcription
            if (this.transcriptionService) {
                await this.transcriptionService.pause();
            }

            console.log('Recording paused successfully');
        } catch (error) {
            console.error('Error pausing recording:', error);
            throw error;
        }
    }
}