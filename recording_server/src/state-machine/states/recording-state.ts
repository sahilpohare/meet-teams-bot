import { Events } from '../../events';
import { MEETING_CONSTANTS } from '../constants';

import { MeetingStateType, StateExecuteResult } from '../types';
import { BaseState } from './base-state';

import { PathManager } from '../../utils/PathManager';


export class RecordingState extends BaseState {
    private isProcessing: boolean = true;
    private pathManager: PathManager;
    private readonly CHECK_INTERVAL = 250;

    async execute(): StateExecuteResult {
        try {
            console.info('Starting recording state');
            
            // Initialiser PathManager
            this.pathManager = PathManager.getInstance(this.context.params.bot_uuid);
            await this.pathManager.initializePaths();
            
            // Initialiser l'enregistrement
            await this.initializeRecording();

            // Boucle principale
            while (this.isProcessing) {
                // Vérifier si on doit s'arrêter
                const { shouldEnd, reason } = await this.checkEndConditions();
                if (shouldEnd) {
                    console.info(`Meeting end condition met: ${reason}`);
                    await this.handleMeetingEnd(reason);
                    break;
                }

                // Si pause demandée, transitionner vers l'état Paused
                if (this.context.isPaused) {
                    return this.transition(MeetingStateType.Paused);
                }

                await this.sleep(this.CHECK_INTERVAL);
            }

            return this.transition(MeetingStateType.Cleanup);
        } catch (error) {
            console.error('Error in recording state:', error);
            return this.handleError(error as Error);
        }
    }

    private async initializeRecording(): Promise<void> {
        // Vérifier que les services sont bien initialisés
        if (!this.context.transcriptionService) {
            throw new Error('TranscriptionService not initialized');
        }
    
        // Configurer les listeners
        await this.setupEventListeners();
        console.info('Recording initialized successfully');
    }

    private async setupEventListeners(): Promise<void> {
        this.context.transcoder?.on('chunkProcessed', async (chunkInfo) => {
            const { startTime, endTime } = this.calculateSegmentTimes(chunkInfo);
            await this.context.transcriptionService?.transcribeSegment(
                startTime, 
                endTime, 
                chunkInfo.audioUrl
            );
        });

        this.context.transcoder?.on('error', async (error) => {
            console.error('Recording error:', error);
            this.context.error = error;
            this.isProcessing = false;
        });

        this.context.transcriptionService?.on('transcriptionComplete', (result) => {
            if (result.results.length > 0) {
                this.context.lastSpeakerTime = Date.now();
            }
        });
    }

    private async checkEndConditions(): Promise<{ shouldEnd: boolean; reason?: string }> {
        const now = Date.now();
    
        try {
            // On vérifie si un arrêt a été demandé via la machine d'état
            if (this.context.endReason) {
                return { shouldEnd: true, reason: this.context.endReason };
            }
    
            // Vérifier si le bot a été retiré
            if (await this.checkBotRemoved()) {
                return { shouldEnd: true, reason: 'bot_removed' };
            }
    
            // Vérifier les participants
            if (await this.checkNoAttendees(now)) {
                return { shouldEnd: true, reason: 'no_attendees' };
            }
    
            // Vérifier l'activité audio
            if (await this.checkNoSpeaker(now)) {
                return { shouldEnd: true, reason: 'no_speaker' };
            }
    
            // Vérifier le timeout global
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
        console.info(`Handling meeting end. Reason: ${reason}`);
        
        try {
            this.context.endReason = reason;
            await Events.callEnded();
            
            // Arrêter les processus
            await this.stopProcesses();
            
            this.isProcessing = false;
        } catch (error) {
            console.error('Error during meeting end:', error);
            throw error;
        }
    }

    private async stopProcesses(): Promise<void> {
        try {
            await this.stopAudioStreaming();
            await Promise.all([
                this.context.transcoder?.stop(),
                this.context.transcriptionService?.stop()
            ]);
        } catch (error) {
            console.error('Error stopping processes:', error);
            throw error;
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
     * @returns true si le meeting doit se terminer
     */
    private checkNoAttendees(now: number): boolean {
        const attendeesCount = this.context.attendeesCount || 0
        const startTime = this.context.startTime || 0
        const firstUserJoined = this.context.firstUserJoined || false

        // Vrai si on a dépassé les 7 minutes initiales
        const noAttendeesTimeout =
            startTime + MEETING_CONSTANTS.INITIAL_WAIT_TIME < now
        // Vrai si au moins un utilisateur a rejoint puis est parti
        const noAttendeesAfterJoin = firstUserJoined

        console.log('--------------------------------')
        console.log('attendeesCount', attendeesCount)
        console.log('noAttendeesTimeout', noAttendeesTimeout)
        console.log('noAttendeesAfterJoin', noAttendeesAfterJoin)
        console.log('--------------------------------')

        // On termine si :
        // - Il n'y a personne actuellement ET
        // - Soit on a dépassé le timeout initial, soit quelqu'un était là mais est parti
        return (
            attendeesCount === 0 && (noAttendeesTimeout || noAttendeesAfterJoin)
        )
    }

    /**
     * Vérifie si le meeting doit se terminer à cause d'une absence de son
     * Plusieurs cas sont gérés :
     * 1. Avec participants : on vérifie juste le temps sans son (15 minutes)
     * 2. Sans participants : on vérifie le temps initial (7 minutes) ET le temps sans son (15 minutes)
     * 3. Si on a un timestamp de début de silence : on vérifie les 15 minutes de silence
     * @param now Timestamp actuel
     * @returns true si le meeting doit se terminer
     */
    private checkNoSpeaker(now: number): boolean {
        const startTime = this.context.startTime || 0
        const lastSpeakerTime = this.context.lastSpeakerTime
        const hasAttendees = this.context.attendeesCount > 0
        const noSpeakerDetectedTime = this.context.noSpeakerDetectedTime || 0
        const firstUserJoined = this.context.firstUserJoined || false

        console.log('--------------------------------')
        console.log('hasAttendees', hasAttendees)
        console.log('lastSpeakerTime', lastSpeakerTime)
        console.log('startTime', startTime)
        console.log('--------------------------------')

        // Cas 1 : Il y a des participants et on a un timestamp de dernière parole
        if (hasAttendees && lastSpeakerTime !== null) {
            // On vérifie uniquement si personne n'a parlé depuis 15 minutes
            return lastSpeakerTime + MEETING_CONSTANTS.SILENCE_TIMEOUT < now
        }

        // Cas 2 : On a un timestamp de dernière parole mais pas de participants qui ont rejoint l'appel
        if (lastSpeakerTime !== null && firstUserJoined === false) {
            return (
                // On vérifie les deux conditions :
                // - 7 minutes depuis le début du meeting
                startTime + MEETING_CONSTANTS.INITIAL_WAIT_TIME < now &&
                // - 15 minutes sans son
                lastSpeakerTime + MEETING_CONSTANTS.SILENCE_TIMEOUT < now
            )
        }

        // Cas 3 : On a un timestamp de début de silence
        if (noSpeakerDetectedTime !== null) {
            // On vérifie si ça fait 15 minutes qu'on n'a pas de son
            return (
                noSpeakerDetectedTime + MEETING_CONSTANTS.SILENCE_TIMEOUT < now
            )
        }

        // Cas par défaut : on ne termine pas le meeting
        // (c'est le cas si on n'a aucun timestamp valide)
        return false
    }

    private checkRecordingTimeout(now: number): boolean {
        const startTime = this.context.startTime || 0
        return startTime + MEETING_CONSTANTS.RECORDING_TIMEOUT < now
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

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms))
    }

    private calculateSegmentTimes(chunkInfo: any): { startTime: number; endTime: number } {
        return {
            startTime: chunkInfo.timestamp,
            endTime: chunkInfo.timestamp + MEETING_CONSTANTS.CHUNK_DURATION
        };
    }
}
