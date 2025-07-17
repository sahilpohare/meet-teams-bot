import { MeetingEndReason, MeetingStateType, ParticipantState } from './types'

import { MeetProvider } from '../meeting/meet'
import { TeamsProvider } from '../meeting/teams'
import { SimpleDialogObserver } from '../services/dialog-observer/simple-dialog-observer'
import { GLOBAL } from '../singleton'
import { MeetingProviderInterface } from '../types'
import { getStateInstance } from './states'
import { MeetingContext } from './types'

export class MeetingStateMachine {
    static instance: MeetingStateMachine = null
    private currentState: MeetingStateType
    public context: MeetingContext
    private provider: MeetingProviderInterface

    static init() {
        if (MeetingStateMachine.instance == null) {
            this.instance = new MeetingStateMachine()
            console.log(
                '*** INIT MeetingStateMachine.instance',
                GLOBAL.get().meeting_url,
            )
        }
    }

    constructor() {
        this.currentState = MeetingStateType.Initialization
        this.provider =
            GLOBAL.get().meetingProvider === 'Teams'
                ? new TeamsProvider()
                : new MeetProvider()

        this.context = {
            provider: this.provider,
            meetingHandle: this as any, // Type assertion to avoid circular reference
            error: null,
        } as MeetingContext

        this.context.dialogObserver = new SimpleDialogObserver(this.context)
    }

    public async start(): Promise<void> {
        try {
            while (this.currentState !== MeetingStateType.Terminated) {
                console.info(`Current state: ${this.currentState}`)

                // Track recording state for success determination
                if (this.currentState === MeetingStateType.Recording) {
                    // We're in recording state
                }

                // Execute current state and transition to next
                const state = getStateInstance(this.currentState, this.context)
                const transition = await state.execute()

                this.currentState = transition.nextState
                this.context = transition.context
            }

            // State machine completed
        } catch (error) {
            await this.handleError(error as Error)
        }
    }

    public async requestStop(reason: MeetingEndReason): Promise<void> {
        console.info(`Stop requested with reason: ${reason}`)
        GLOBAL.setEndReason(reason)
    }

    public getCurrentState(): MeetingStateType {
        return this.currentState
    }

    public getError(): Error | null {
        return GLOBAL.getError()
    }

    public getStartTime(): number {
        return this.context.startTime!
    }

    private async handleError(error: Error): Promise<void> {
        console.error('Error in state machine:', error)
        // Use singleton for error handling instead of context
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

    // Methods from MeetingHandle
    public async startRecordMeeting(): Promise<void> {
        try {
            await this.start()

            // Check if an error occurred during execution
            if (
                this.getError() ||
                this.currentState === MeetingStateType.Error
            ) {
                throw (
                    this.getError() || new Error('Recording failed to complete')
                )
            }
        } catch (error) {
            console.error(
                'Error in startRecordMeeting:',
                error instanceof Error ? error.message : error,
            )
            throw error
        }
    }

    public async stopMeeting(reason: MeetingEndReason): Promise<void> {
        console.info(`Stop meeting requested with reason: ${reason}`)
        GLOBAL.setEndReason(reason)
    }

    public wasRecordingSuccessful(): boolean {
        if (!GLOBAL.getEndReason() || GLOBAL.hasError()) {
            return false
        }

        const normalReasons = [
            MeetingEndReason.ApiRequest,
            MeetingEndReason.BotRemoved,
            MeetingEndReason.NoAttendees,
            MeetingEndReason.NoSpeaker,
            MeetingEndReason.RecordingTimeout,
        ]

        return normalReasons.includes(GLOBAL.getEndReason() as MeetingEndReason)
    }

    public getEndReason(): MeetingEndReason | undefined {
        return GLOBAL.getEndReason() || undefined
    }
}
