import { Events } from '../../events'
import { JoinError, JoinErrorCode } from '../../types'
import {
    MeetingStateType,
    RecordingEndReason,
    StateExecuteResult,
} from '../types'
import { BaseState } from './base-state'
import { takeScreenshot } from '../../utils/takeScreenshot'

export class WaitingRoomState extends BaseState {
    async execute(): StateExecuteResult {
        try {
            console.info('Entering waiting room state')
            Events.inWaitingRoom()

            // Get meeting information
            const { meetingId, password } = await this.getMeetingInfo()
            console.info('Meeting info retrieved', {
                meetingId,
                hasPassword: !!password,
            })

            // Generate the meeting link
            const meetingLink = this.context.provider.getMeetingLink(
                meetingId,
                password,
                0,
                this.context.params.bot_name,
                this.context.params.enter_message,
            )

            // Open the meeting page
            await this.openMeetingPage(meetingLink)

            // Start the dialog observer once the page is open
            this.startDialogObserver()

            // Wait for acceptance into the meeting
            await this.waitForAcceptance()
            console.info('Successfully joined meeting')

            // If everything is fine, move to the InCall state
            return this.transition(MeetingStateType.InCall)
        } catch (error) {
            // Arrêter l'observateur en cas d'erreur
            this.stopDialogObserver()

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
                    await takeScreenshot(
                        this.context.playwrightPage,
                        'waiting-room-error',
                    )
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

        const timeoutMs =
            this.context.params.automatic_leave.waiting_room_timeout * 1000
        console.info(`Setting waiting room timeout to ${timeoutMs}ms`)

        let joinSuccessful = false // Flag indicating we joined the meeting

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (!joinSuccessful) {
                    // Trigger the timeout only if we are not in the meeting
                    const timeoutError = new JoinError(
                        JoinErrorCode.TimeoutWaitingToStart,
                    )
                    console.error('Waiting room timeout reached', timeoutError)
                    reject(timeoutError)
                }
            }, timeoutMs)

            const checkStopSignal = setInterval(() => {
                if (this.context.endReason === RecordingEndReason.ApiRequest) {
                    clearInterval(checkStopSignal)
                    clearTimeout(timeout)
                    reject(new JoinError(JoinErrorCode.ApiRequest))
                }
            }, 1000)

            this.context.provider
                .joinMeeting(
                    this.context.playwrightPage,
                    () =>
                        this.context.endReason ===
                        RecordingEndReason.ApiRequest,
                    this.context.params,
                    // Add a callback to notify that the join succeeded
                    () => {
                        joinSuccessful = true
                        console.log('Join successful notification received')
                    },
                )
                .then(() => {
                    clearInterval(checkStopSignal)
                    clearTimeout(timeout)
                    resolve()
                })
                .catch((error) => {
                    clearInterval(checkStopSignal)
                    clearTimeout(timeout)
                    reject(error)
                })
        })
    }
}
