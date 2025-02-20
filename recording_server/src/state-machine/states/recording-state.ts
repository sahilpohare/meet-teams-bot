import { Events } from '../../events';
import { MEETING_CONSTANTS } from '../constants';

import { MeetingStateType, StateExecuteResult } from '../types';
import { BaseState } from './base-state';

export class RecordingState extends BaseState {
    private readonly CHECK_INTERVAL = 250; // 250ms

    async execute(): StateExecuteResult {
        try {
            console.info('Starting recording monitoring');
            
            while (true) {
                // Vérifier si la réunion doit se terminer
                const { shouldEnd, reason } = await this.checkEndConditions();
                
                if (shouldEnd) {
                    console.info(`Meeting end condition met: ${reason}`);
                    await this.handleMeetingEnd(reason);
                    return this.transition(MeetingStateType.Cleanup);
                }

                // Attendre avant la prochaine vérification
                await this.sleep(this.CHECK_INTERVAL);
            }
        } catch (error) {
            console.error('Error in recording state:', error);
            return this.handleError(error as Error);
        }
    }

    private async checkEndConditions(): Promise<{ shouldEnd: boolean; reason?: string }> {
        const now = Date.now();

        try {
            // Vérifier si le bot a été retiré
            if (await this.checkBotRemoved()) {
                return { shouldEnd: true, reason: 'bot_removed' };
            }

            // Vérifier s'il n'y a plus de participants
            if (await this.checkNoAttendees(now)) {
                return { shouldEnd: true, reason: 'no_attendees' };
            }

            // Vérifier s'il n'y a pas eu de son depuis longtemps
            if (await this.checkNoSpeaker(now)) {
                return { shouldEnd: true, reason: 'no_speaker' };
            }

            // Vérifier le timeout global de l'enregistrement
            if (this.checkRecordingTimeout(now)) {
                return { shouldEnd: true, reason: 'recording_timeout' };
            }

            return { shouldEnd: false };
        } catch (error) {
            console.error('Error checking end conditions:', error);
            return { shouldEnd: true, reason: 'error_during_check' };
        }
    }

    private async handleMeetingEnd(reason: string): Promise<void> {
        try {
            console.info(`Handling meeting end. Reason: ${reason}`);
            
            // Mettre à jour le contexte
            this.context.endReason = reason;

            // Notifier de la fin de l'appel
            await Events.callEnded();

            // Arrêter l'audio streaming
            await this.stopAudioStreaming();
        } catch (error) {
            console.error('Error during meeting end handling:', error);
            throw error;
        }
    }

    private async checkBotRemoved(): Promise<boolean> {
        if (!this.context.playwrightPage) {
            console.error('Playwright page not available');
            return true;
        }

        try {
            return await this.context.provider.findEndMeeting(
                this.context.params,
                this.context.playwrightPage
            );
        } catch (error) {
            console.error('Error checking if bot was removed:', error);
            return false;
        }
    }

    private checkNoAttendees(now: number): boolean {
        const attendeesCount = this.context.attendeesCount || 0;
        const startTime = this.context.startTime || 0;
        const firstUserJoined = this.context.firstUserJoined || false;

        const noAttendeesTimeout = startTime + MEETING_CONSTANTS.NO_SPEAKER_THRESHOLD < now;
        const noAttendeesAfterJoin = firstUserJoined;

        return attendeesCount === 0 && (noAttendeesTimeout || noAttendeesAfterJoin);
    }

    private checkNoSpeaker(now: number): boolean {
        const startTime = this.context.startTime || 0;
        const lastSpeakerTime = this.context.lastSpeakerTime || 0;

        return (
            startTime + MEETING_CONSTANTS.NO_SPEAKER_THRESHOLD < now &&
            lastSpeakerTime + MEETING_CONSTANTS.NO_SPEAKER_DETECTED_TIMEOUT < now
        );
    }

    private checkRecordingTimeout(now: number): boolean {
        const startTime = this.context.startTime || 0;
        return startTime + MEETING_CONSTANTS.RECORDING_TIMEOUT < now;
    }

    private async stopAudioStreaming(): Promise<void> {
        if (!this.context.backgroundPage) {
            console.error('Background page not available for stopping audio');
            return;
        }

        try {
            await this.context.backgroundPage.evaluate(() => {
                const w = window as any;
                return w.stopAudioStreaming();
            });
            console.info('Audio streaming stopped successfully');
        } catch (error) {
            console.error('Failed to stop audio streaming:', error);
            throw error;
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}