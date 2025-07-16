import { Events } from '../../events'
import { GLOBAL } from '../../singleton'
import { JoinError } from '../../types'
import {
    MeetingEndReason,
    MeetingStateType,
    StateExecuteResult,
} from '../types'
import { BaseState } from './base-state'

export class ErrorState extends BaseState {
    async execute(): StateExecuteResult {
        try {
            // Log the error
            await this.logError()

            // Notify error events
            await this.notifyError()

            // Update metrics
            this.updateMetrics()

            // Move to cleanup
            return this.transition(MeetingStateType.Cleanup)
        } catch (error) {
            console.error('Error in ErrorState:', error)
            // Even if error handling fails, transition to cleanup
            return this.transition(MeetingStateType.Cleanup)
        }
    }

    private async logError(): Promise<void> {
        const error = GLOBAL.getError()

        if (!error) {
            console.error('Unknown error occurred')
            return
        }

        // Store error in global singleton if it's a JoinError
        if (error instanceof JoinError) {
            GLOBAL.setError(error)
        }

        // Create a detailed error object
        const errorDetails = {
            message: error.message,
            stack: error.stack,
            type: error.constructor.name,
            isJoinError: error instanceof JoinError,
            reason: error instanceof JoinError ? error.reason : undefined,
            details: error instanceof JoinError ? error.details : undefined,
            state: this.stateType,
            meetingUrl: GLOBAL.get().meeting_url,
            botName: GLOBAL.get().bot_name,
            sessionId: GLOBAL.get().session_id,
            timestamp: Date.now(),
        }

        // Log the error with all details
        console.error('Meeting error occurred:', errorDetails)
    }

    private async notifyError(): Promise<void> {
        const notifyPromise = async (): Promise<void> => {
            const error = GLOBAL.getError()

            if (!error) {
                console.warn('No error found in global singleton')
                return
            }

            // Full log for debugging
            console.log('Error in notifyError:', {
                isJoinError: error instanceof JoinError,
                name: error.name,
                message: error.message,
                reason:
                    error instanceof JoinError
                        ? error.reason
                        : 'not a JoinError',
                stack: error.stack?.substring(0, 200), // Limite la taille du stack
            })

            try {
                if (error instanceof JoinError) {
                    // Use the reason directly from JoinError
                    const reason = error.reason
                    console.log('JoinError reason:', reason)

                    switch (reason) {
                        case MeetingEndReason.BotNotAccepted:
                            await Events.botRejected()
                            break
                        case MeetingEndReason.BotRemoved:
                            await Events.botRemoved()
                            break
                        case MeetingEndReason.BotRemovedTooEarly:
                            await Events.botRemovedTooEarly()
                            break
                        case MeetingEndReason.TimeoutWaitingToStart:
                            await Events.waitingRoomTimeout()
                            break
                        case MeetingEndReason.InvalidMeetingUrl:
                            await Events.invalidMeetingUrl()
                            break
                        case MeetingEndReason.ApiRequest:
                            console.log('Notifying API request stop')
                            await Events.apiRequestStop()
                            break
                        default:
                            console.log(`Unhandled JoinError reason: ${reason}`)
                            await Events.meetingError(error)
                    }
                } else {
                    await Events.meetingError(error)
                }
            } catch (eventError) {
                console.error('Failed to send event notification:', eventError)
            }
        }

        // Increase timeout for error notification
        const timeoutPromise = new Promise<void>(
            (_, reject) =>
                setTimeout(
                    () => reject(new Error('Notify error timeout')),
                    15000,
                ), // 15 seconds instead of 5
        )

        try {
            await Promise.race([notifyPromise(), timeoutPromise])
        } catch (error) {
            console.error('Error notification timed out:', error)
            // Continue even if notification fails
        }
    }

    private updateMetrics(): void {
        const error = GLOBAL.getError()

        const metrics = {
            errorType:
                error instanceof JoinError ? 'JoinError' : 'UnknownError',
            errorReason: error instanceof JoinError ? error.reason : 'Internal',
            timestamp: Date.now(),
            meetingDuration: this.context.startTime
                ? Date.now() - this.context.startTime
                : 0,
            state: this.stateType,
            // Other relevant context metrics
            attendeesCount: this.context.attendeesCount,
            firstUserJoined: this.context.firstUserJoined,
            sessionId: GLOBAL.get().session_id,
        }

        // Log metrics
        console.info('Error metrics:', metrics)
    }
}
