import { Events } from '../../events';
import { TRANSCODER } from '../../recording/Transcoder';

import { TranscriptionService } from '../../transcription/TranscriptionService';
import { MeetingStateType, StateExecuteResult } from '../types';
import { BaseState } from './base-state';

export class ResumingState extends BaseState {
    private transcriptionService: TranscriptionService;

    async execute(): StateExecuteResult {
        try {
            // Récupérer le service de transcription depuis le contexte
            this.transcriptionService = this.context.transcriptionService;

            // Reprendre l'enregistrement
            await this.resumeRecording();

            // Notifier de la reprise
            Events.recordingResumed();

            // Réinitialiser les variables de pause
            this.context.pauseStartTime = null;
            this.context.isPaused = false;

            // Restaurer l'état précédent
            if (this.context.lastRecordingState) {
                const { attendeesCount, lastSpeakerTime, noSpeakerDetectedTime } = this.context.lastRecordingState;
                
                // Mettre à jour le contexte avec les valeurs sauvegardées
                this.context.attendeesCount = attendeesCount;
                this.context.lastSpeakerTime = lastSpeakerTime;
                this.context.noSpeakerDetectedTime = noSpeakerDetectedTime;
            }

            // Retourner à l'état Recording
            return this.transition(MeetingStateType.Recording);
        } catch (error) {
            console.error('Error in resuming state:', error);
            return this.handleError(error as Error);
        }
    }

    private async resumeRecording(): Promise<void> {
        try {
            // Reprendre le MediaRecorder dans le navigateur
            await this.context.backgroundPage?.evaluate(() => {
                const w = window as any;
                return w.resumeMediaRecorder?.();
            });

            // Reprendre le Transcoder
            await TRANSCODER.resume();

            // Reprendre le service de transcription
            if (this.transcriptionService) {
                await this.transcriptionService.resume();
            }

            // Reprendre le streaming
            if (this.context.streamingService) {
                this.context.streamingService.resume();
            }

            console.log('Recording resumed successfully');
        } catch (error) {
            console.error('Error resuming recording:', error);
            throw error;
        }
    }
}