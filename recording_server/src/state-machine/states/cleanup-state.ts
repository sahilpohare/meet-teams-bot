import { delSessionInRedis } from '../../instance';
import { Logger } from '../../logger';
import { SoundContext, VideoContext } from '../../media_context';
import { TRANSCODER } from '../../transcoder';
import { uploadTranscriptTask } from '../../uploadTranscripts';
import { WordsPoster } from '../../words_poster/words_poster';
import { MeetingStateType, StateExecuteResult } from '../types';
import { BaseState } from './base-state';

export class CleanupState extends BaseState {
    async execute(): StateExecuteResult {
        try {
            await this.performCleanup();
            return this.transition(MeetingStateType.Cleanup); // État final
        } catch (error) {
            console.error('Error during cleanup:', error);
            // Même en cas d'erreur, on reste dans l'état Cleanup
            return this.transition(MeetingStateType.Cleanup);
        }
    }

    private async performCleanup(): Promise<void> {
        // Utilisation d'un Promise.allSettled pour s'assurer que toutes les opérations
        // de nettoyage sont tentées, même si certaines échouent
        const cleanupTasks = [
            this.uploadLogs(),
            this.stopMediaProcesses(),
            this.cleanupBrowser(),
            this.stopTranscoder(),
            this.finalizeTranscriptions(),
            this.cleanupRedisSession()
        ];

        const results = await Promise.allSettled(cleanupTasks);
        
        // Log des résultats pour le debugging
        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                console.error(`Cleanup task ${index} failed:`, result.reason);
            }
        });
    }

    private async uploadLogs(): Promise<void> {
        try {
            await Logger.instance.upload_log();
        } catch (error) {
            console.error('Failed to upload logs:', error);
        }
    }

    private async stopMediaProcesses(): Promise<void> {
        try {
            // Arrêt des processus de branding si existants
            if (this.context.brandingProcess) {
                this.context.brandingProcess.kill();
            }

            // Arrêt des contextes média
            VideoContext.instance?.stop();
            SoundContext.instance?.stop();
        } catch (error) {
            console.error('Failed to stop media processes:', error);
        }
    }

    private async cleanupBrowser(): Promise<void> {
        try {
            // Fermeture des pages
            if (this.context.playwrightPage) {
                await this.context.playwrightPage.close().catch(() => {});
            }
            if (this.context.backgroundPage) {
                await this.context.backgroundPage.close().catch(() => {});
            }
            // Fermeture du contexte du navigateur
            if (this.context.browserContext) {
                await this.context.browserContext.close().catch(() => {});
            }
            // Nettoyage des timeouts
            if (this.context.meetingTimeoutInterval) {
                clearTimeout(this.context.meetingTimeoutInterval);
            }
        } catch (error) {
            console.error('Failed to cleanup browser:', error);
        }
    }

    private async stopTranscoder(): Promise<void> {
        try {
            if (TRANSCODER) {
                await TRANSCODER.stop();
            }
        } catch (error) {
            console.error('Failed to stop transcoder:', error);
        }
    }

    private async finalizeTranscriptions(): Promise<void> {
        try {
            // Arrêt du WordsPoster
            if (WordsPoster.TRANSCRIBER) {
                await WordsPoster.TRANSCRIBER.stop();
            }

            // Upload de la dernière transcription
            await uploadTranscriptTask(
                {
                    name: 'END',
                    id: 0,
                    timestamp: Date.now(),
                    isSpeaking: false,
                },
                true
            );
        } catch (error) {
            console.error('Failed to finalize transcriptions:', error);
        }
    }

    private async cleanupRedisSession(): Promise<void> {
        try {
            if (this.context.params.session_id) {
                await delSessionInRedis(this.context.params.session_id);
            }
        } catch (error) {
            console.error('Failed to cleanup Redis session:', error);
        }
    }
}