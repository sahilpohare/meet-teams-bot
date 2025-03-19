import { Events } from '../../events'
import { JoinError, JoinErrorCode } from '../../types'
import { MeetingStateType, RecordingEndReason, StateExecuteResult } from '../types'
import { BaseState } from './base-state'

export class WaitingRoomState extends BaseState {
    async execute(): StateExecuteResult {
        try {
            console.info('Entering waiting room state')
            Events.inWaitingRoom()

            // Obtenir les informations de la réunion
            const { meetingId, password } = await this.getMeetingInfo()
            console.info('Meeting info retrieved', {
                meetingId,
                hasPassword: !!password,
            })

            // Générer le lien de réunion
            const meetingLink = this.context.provider.getMeetingLink(
                meetingId,
                password,
                0,
                this.context.params.bot_name,
                this.context.params.enter_message,
            )

            // Ouvrir la page de réunion
            await this.openMeetingPage(meetingLink)

            // Attendre l'acceptation dans la réunion
            await this.waitForAcceptance()
            console.info('Successfully joined meeting')

            // Si tout est OK, passer à l'état InCall
            return this.transition(MeetingStateType.InCall)
        } catch (error) {
            console.error('Error in waiting room state:', error)

            if (error instanceof JoinError) {
                switch (error.message) {
                    case JoinErrorCode.BotNotAccepted:
                        Events.botRejected()
                        return this.handleError(error)
                    case JoinErrorCode.TimeoutWaitingToStart:
                        Events.waitingRoomTimeout()
                        return this.handleError(error)
                }
            }

            return this.handleError(error as Error)
        }
    }

    private async getMeetingInfo() {
        if (!this.context.browserContext) {
            throw new Error('Browser context not initialized')
        }

        try {
            const { meeting_url } = this.context.params
            return await this.context.provider.parseMeetingUrl(meeting_url)
        } catch (error) {
            console.error('Failed to parse meeting URL:', error)
            throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
        }
    }

    private async openMeetingPage(meetingLink: string) {
        if (!this.context.browserContext) {
            throw new Error('Browser context not initialized')
        }

        try {
            console.info('Attempting to open meeting page:', meetingLink)
            this.context.playwrightPage =
                await this.context.provider.openMeetingPage(
                    this.context.browserContext,
                    meetingLink,
                    this.context.params.streaming_input,
                )
            console.info('Meeting page opened successfully')
        } catch (error) {
            console.error('Failed to open meeting page:', {
                error,
                message:
                    error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
            })

            // Take screenshot if possible
            if (this.context.playwrightPage) {
                try {
                    await this.context.playwrightPage.screenshot({
                        path: 'error-screenshot.png',
                        fullPage: true,
                    })
                    console.info('Error screenshot saved')
                } catch (screenshotError) {
                    console.error(
                        'Failed to take error screenshot:',
                        screenshotError,
                    )
                }
            }

            throw new Error(
                error instanceof Error
                    ? error.message
                    : 'Failed to open meeting page',
            )
        }
    }

    private async waitForAcceptance(): Promise<void> {
        if (!this.context.playwrightPage) {
            throw new Error('Meeting page not initialized')
        }

        const timeoutMs = this.context.params.automatic_leave.waiting_room_timeout * 1000
        console.info(`Setting waiting room timeout to ${timeoutMs}ms`)

        return new Promise((resolve, reject) => {
            // Référence au timeout pour pouvoir l'annuler
            const timeout = setTimeout(() => {
                const timeoutError = new JoinError(JoinErrorCode.TimeoutWaitingToStart)
                console.error('Waiting room timeout reached', timeoutError)
                reject(timeoutError)
            }, timeoutMs)

            // Ajouter un mécanisme de vérification périodique des signaux d'arrêt
            const checkStopSignal = setInterval(() => {
                if (this.context.endReason === RecordingEndReason.ApiRequest) {
                    clearInterval(checkStopSignal)
                    clearTimeout(timeout)
                    console.log('API request to stop received while in waiting room')
                    reject(new JoinError(JoinErrorCode.ApiRequest))
                }
            }, 1000)

            this.context.provider
                .joinMeeting(
                    this.context.playwrightPage,
                    () => this.context.endReason === RecordingEndReason.ApiRequest, // Vérifier aussi ici
                    this.context.params,
                )
                .then(() => {
                    clearInterval(checkStopSignal)
                    clearTimeout(timeout)
                    resolve()
                })
                .catch((error) => {
                    clearInterval(checkStopSignal)
                    clearTimeout(timeout)
                    if (error instanceof JoinError) {
                        console.error('Join meeting error:', error)
                    } else {
                        console.error('Unexpected error during join:', error)
                    }
                    reject(error)
                })
        })
    }
}
