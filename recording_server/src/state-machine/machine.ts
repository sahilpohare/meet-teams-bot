import { MeetingStateType, ParticipantState, StateTransition } from './types'

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
            startTime: Date.now(),
            error: null,
        } as MeetingContext
    }

    public async start(): Promise<void> {
        try {
            while (
                this.currentState !== MeetingStateType.Cleanup &&
                !this.forceStop
            ) {
                console.info(`Current state: ${this.currentState}`)

                const state = getStateInstance(this.currentState, this.context)
                const transition: StateTransition = await state.execute()

                // Mise à jour du contexte et de l'état
                this.currentState = transition.nextState
                this.context = transition.context

                // Vérifier si on a une demande d'arrêt
                if (this.forceStop) {
                    this.context.endReason =
                        this.context.endReason || 'forced_stop'
                    await this.transitionToCleanup()
                }
            }
        } catch (error) {
            this.error = error as Error
            await this.handleError(error as Error)
        }
    }

    public async requestStop(reason: string): Promise<void> {
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

    public updateParticipantState(state: ParticipantState): void {
        if (this.currentState === MeetingStateType.Recording) {
            this.context.attendeesCount = state.attendeesCount
            this.context.firstUserJoined = state.firstUserJoined
            // On met toujours à jour ces valeurs
            this.context.lastSpeakerTime = state.lastSpeakerTime
            this.context.noSpeakerDetectedTime = state.noSpeakerDetectedTime

            console.info('Updated participant state:', {
                attendeesCount: state.attendeesCount,
                firstUserJoined: state.firstUserJoined,
                lastSpeakerTime: state.lastSpeakerTime, // On log aussi ces valeurs
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
