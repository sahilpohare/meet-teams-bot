import { Events } from '../../events'

import { GLOBAL } from '../../singleton'
import { MEETING_CONSTANTS } from '../constants'
import { MeetingStateType, StateExecuteResult } from '../types'
import { BaseState } from './base-state'

export class PausedState extends BaseState {
    async execute(): StateExecuteResult {
        try {
            // Marquer le début de la pause
            if (!this.context.pauseStartTime) {
                this.context.pauseStartTime = Date.now()
            }

            // Sauvegarder l'état actuel
            this.context.lastRecordingState = {
                timestamp: Date.now(),
                attendeesCount: this.context.attendeesCount,
                lastSpeakerTime: this.context.lastSpeakerTime,
                noSpeakerDetectedTime: this.context.noSpeakerDetectedTime,
            }

            // Pause de l'enregistrement et de la transcription
            await this.pauseRecording()

            // Notifier de la pause
            Events.recordingPaused()

            // 1 heure par exemple
            const pauseStartTime = Date.now()

            // Attendre la demande de reprise
            while (this.context.isPaused) {
                await new Promise((resolve) => setTimeout(resolve, 100))

                // Check if we should stop completely
                if (GLOBAL.getEndReason()) {
                    return this.transition(MeetingStateType.Cleanup)
                }

                // Check if the pause has lasted too long
                if (
                    Date.now() - pauseStartTime >
                    MEETING_CONSTANTS.RESUMING_TIMEOUT
                ) {
                    console.warn(
                        'Maximum pause duration exceeded, forcing resume',
                    )
                    this.context.isPaused = false
                    break
                }
            }

            // Calculer la durée de pause
            if (this.context.pauseStartTime) {
                const pauseDuration = Date.now() - this.context.pauseStartTime
                this.context.totalPauseDuration =
                    (this.context.totalPauseDuration || 0) + pauseDuration
            }

            return this.transition(MeetingStateType.Resuming)
        } catch (error) {
            console.error('Error in paused state:', error)
            return this.handleError(error as Error)
        }
    }

    private async pauseRecording(): Promise<void> {
        const pausePromise = async () => {
            // TODO: PAUSE SCREEN RECORDER

            // Streaming service paused
            if (this.context.streamingService) {
                this.context.streamingService.pause()
                console.log('Streaming service paused successfully')
            }

            // Speakers observation paused
            if (this.context.speakersObserver) {
                this.context.speakersObserver.stopObserving()
                console.log('Speakers observation paused')
            }

            console.log('Recording paused successfully')
        }

        const timeoutPromise = new Promise<void>(
            (_, reject) =>
                setTimeout(
                    () => reject(new Error('Pause recording timeout')),
                    20000,
                ), // 20 secondes
        )

        try {
            await Promise.race([pausePromise(), timeoutPromise])
        } catch (error) {
            console.error('Error or timeout in pauseRecording:', error)
            throw error
        }
    }
}
