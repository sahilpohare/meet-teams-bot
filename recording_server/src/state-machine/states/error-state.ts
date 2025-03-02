import { Events } from '../../events'
import { JoinError, JoinErrorCode } from '../../types'
import { MeetingStateType, StateExecuteResult } from '../types'
import { BaseState } from './base-state'

export class ErrorState extends BaseState {
    async execute(): StateExecuteResult {
        try {
            // Log l'erreur
            await this.logError()

            // Notification des événements d'erreur
            await this.notifyError()

            // Mise à jour des métriques
            this.updateMetrics()

            // Passage au nettoyage
            return this.transition(MeetingStateType.Cleanup)
        } catch (error) {
            console.error('Error in ErrorState:', error)
            // Même en cas d'erreur dans la gestion d'erreur, on passe au nettoyage
            return this.transition(MeetingStateType.Cleanup)
        }
    }

    private async logError(): Promise<void> {
        const error = this.context.error

        if (!error) {
            console.error('Unknown error occurred')
            return
        }

        // Création d'un objet d'erreur détaillé
        const errorDetails = {
            message: error.message,
            stack: error.stack,
            type: error.constructor.name,
            isJoinError: error instanceof JoinError,
            code: error instanceof JoinError ? error.message : undefined,
            details: error instanceof JoinError ? error.details : undefined,
            state: this.stateType,
            meetingUrl: this.context.params?.meeting_url,
            botName: this.context.params?.bot_name,
            sessionId: this.context.params?.session_id,
            timestamp: Date.now(),
        }

        // Log de l'erreur avec tous les détails
        console.error('Meeting error occurred:', errorDetails)
    }

    private async notifyError(): Promise<void> {
        const error = this.context.error

        if (error instanceof JoinError) {
            switch (error.message) {
                case JoinErrorCode.BotNotAccepted:
                    Events.botRejected()
                    break
                case JoinErrorCode.BotRemoved:
                    Events.botRemoved()
                    break
                case JoinErrorCode.TimeoutWaitingToStart:
                    Events.waitingRoomTimeout()
                    break
                case JoinErrorCode.InvalidMeetingUrl:
                    Events.invalidMeetingUrl()
                    break
                default:
                    Events.meetingError(error)
            }
        } else {
            Events.meetingError(error)
        }
    }

    private updateMetrics(): void {
        const error = this.context.error

        const metrics = {
            errorType:
                error instanceof JoinError ? 'JoinError' : 'UnknownError',
            errorCode: error instanceof JoinError ? error.message : 'Internal',
            timestamp: Date.now(),
            meetingDuration: this.context.startTime
                ? Date.now() - this.context.startTime
                : 0,
            state: this.stateType,
            // Autres métriques pertinentes du contexte
            attendeesCount: this.context.attendeesCount,
            firstUserJoined: this.context.firstUserJoined,
            sessionId: this.context.params?.session_id,
        }

        // Log des métriques
        console.info('Error metrics:', metrics)

        // Ici, vous pouvez envoyer les métriques à votre système de monitoring
        // Par exemple :
        // await MetricsService.recordError(metrics);
    }
}
