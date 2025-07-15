import {
    MeetingStateType,
    ParticipantState,
    RecordingEndReason,
    StateTransition,
} from './types'

import { DialogObserver } from '../services/dialog-observer/dialog-observer'
import { getStateInstance } from './states'
import { MeetingContext } from './types'

export class MeetingStateMachine {
    private currentState: MeetingStateType
    public context: MeetingContext
    private error: Error | null = null
    private forceStop: boolean = false
    private wasInRecordingState: boolean = false
    private normalTermination: boolean = false

    constructor(initialContext: Partial<MeetingContext>) {
        this.currentState = MeetingStateType.Initialization
        this.context = {
            ...initialContext,
            error: null,
        } as MeetingContext

        this.context.dialogObserver = new DialogObserver(this.context)
    }

    public async start(): Promise<void> {
        try {
            while (
                this.currentState !== MeetingStateType.Terminated &&
                !this.forceStop
            ) {
                console.info(`Current state: ${this.currentState}`)

                if (this.currentState === MeetingStateType.Recording) {
                    this.wasInRecordingState = true
                }

                if (this.forceStop) {
                    this.context.endReason =
                        this.context.endReason || RecordingEndReason.ApiRequest
                }

                const state = getStateInstance(this.currentState, this.context)
                const transition: StateTransition = await state.execute()

                this.currentState = transition.nextState
                this.context = transition.context
            }

            if (this.wasInRecordingState && this.context.endReason) {
                const normalReasons = [
                    RecordingEndReason.ApiRequest,
                    RecordingEndReason.BotRemoved,
                    RecordingEndReason.ManualStop,
                    RecordingEndReason.NoAttendees,
                    RecordingEndReason.NoSpeaker,
                    RecordingEndReason.RecordingTimeout,
                ]
                this.normalTermination = normalReasons.includes(
                    this.context.endReason,
                )
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
        console.error('Error in state machine:', error)
        this.error = error
        this.context.error = error
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

            // console.info('Updated participant state:', {
            //     attendeesCount: state.attendeesCount,
            //     firstUserJoined: this.context.firstUserJoined,
            //     lastSpeakerTime: state.lastSpeakerTime,
            //     noSpeakerDetectedTime: state.noSpeakerDetectedTime,
            //     state: this.currentState,
            // })
        }
    }

    public getContext(): MeetingContext {
        return this.context
    }

    public wasRecordingSuccessful(): boolean {
        return this.wasInRecordingState && this.normalTermination && !this.error
    }

    public getWasInRecordingState(): boolean {
        return this.wasInRecordingState
    }
}
