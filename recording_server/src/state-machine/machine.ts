import {
    MeetingStateType,
    ParticipantState,
    RecordingEndReason,
    StateTransition,
} from './types'

import { getStateInstance } from './states'
import { MeetingContext } from './types'

export class MeetingStateMachine {
    private currentState: MeetingStateType
    private context: MeetingContext
    private error: Error | null = null
    private forceStop: boolean = false

    constructor(initialContext: Partial<MeetingContext>) {
        this.currentState = MeetingStateType.Initialization
        this.context = {
            ...initialContext,
            error: null,
        } as MeetingContext
    }

    public async start(): Promise<void> {
        try {
            while (
                this.currentState !== MeetingStateType.Cleanup &&
                this.currentState !== MeetingStateType.Terminated &&
                !this.forceStop
            ) {
                console.info(`Current state: ${this.currentState}`)

                if (this.forceStop) {
                    this.context.endReason =
                        this.context.endReason || RecordingEndReason.ApiRequest
                    await this.transitionToCleanup()
                    break
                }

                const state = getStateInstance(this.currentState, this.context)
                const transition: StateTransition = await state.execute()

                this.currentState = transition.nextState
                this.context = transition.context
            }
        } catch (error) {
            this.error = error as Error
            await this.handleError(error as Error)
        }
    }

    public async requestStop(reason: RecordingEndReason): Promise<void> {
        console.info(`Stop requested with reason: ${reason}`)
        this.forceStop = true
        this.context.endReason = reason
    }

    public getCurrentState(): MeetingStateType {
        return this.currentState
    }

    public getError(): Error | null {
        return this.error
    }

    public getStartTime(): number {
        return this.context.startTime!
    }

    private async handleError(error: Error): Promise<void> {
        try {
            console.error('Error in state machine:', error)
            this.error = error
            this.context.error = error

            // Passer à l'état d'erreur
            const errorState = getStateInstance(
                MeetingStateType.Error,
                this.context,
            )
            await errorState.execute()
        } catch (secondaryError) {
            console.error('Error handling error:', secondaryError)
        } finally {
            // Dans tous les cas, on termine par le nettoyage
            await this.transitionToCleanup()
        }
    }

    public async pauseRecording(): Promise<void> {
        if (this.currentState !== MeetingStateType.Recording) {
            throw new Error('Cannot pause: meeting is not in recording state')
        }

        console.info('Pause requested')
        this.context.isPaused = true
        this.currentState = MeetingStateType.Paused
    }

    public async resumeRecording(): Promise<void> {
        if (this.currentState !== MeetingStateType.Paused) {
            throw new Error('Cannot resume: meeting is not paused')
        }

        console.info('Resume requested')
        this.context.isPaused = false
        this.currentState = MeetingStateType.Resuming
    }

    public isPaused(): boolean {
        return this.currentState === MeetingStateType.Paused
    }

    public getPauseDuration(): number {
        return this.context.totalPauseDuration || 0
    }

    public updateParticipantState(state: ParticipantState): void {
        if (this.currentState === MeetingStateType.Recording) {
            this.context.attendeesCount = state.attendeesCount
            if (state.firstUserJoined) {
                this.context.firstUserJoined = true
            }
            this.context.lastSpeakerTime = state.lastSpeakerTime
            this.context.noSpeakerDetectedTime = state.noSpeakerDetectedTime

            console.info('Updated participant state:', {
                attendeesCount: state.attendeesCount,
                firstUserJoined: this.context.firstUserJoined,
                lastSpeakerTime: state.lastSpeakerTime,
                noSpeakerDetectedTime: state.noSpeakerDetectedTime,
                state: this.currentState,
            })
        }
    }

    private async transitionToCleanup(): Promise<void> {
        this.currentState = MeetingStateType.Cleanup
        const cleanupState = getStateInstance(
            MeetingStateType.Cleanup,
            this.context,
        )
        await cleanupState.execute()
    }

    public getContext(): MeetingContext {
        return this.context
    }
}
