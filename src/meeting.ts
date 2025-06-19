import { MeetingParams, MeetingProviderInterface } from './types'

// import { Browser as PuppeteerBrowser, Page as PuppeteerPage } from 'puppeteer'
import { MeetProvider } from './meeting/meet'
import { TeamsProvider } from './meeting/teams'
import { MeetingStateMachine } from './state-machine/machine'
import {
    MeetingStateType,
    ParticipantState,
    RecordingEndReason,
} from './state-machine/types'
import { GLOBAL } from './singleton'

export class MeetingHandle {
    static instance: MeetingHandle = null
    public stateMachine: MeetingStateMachine
    private provider: MeetingProviderInterface

    static init() {
        if (MeetingHandle.instance == null) {
            this.instance = new MeetingHandle()
            console.log(
                '*** INIT MeetingHandle.instance',
                GLOBAL.get().meeting_url,
            )
        }
    }

    constructor() {
        GLOBAL.get().meetingProvider === 'Teams'
            ? new TeamsProvider()
            : new MeetProvider()
        // Initialisation de la machine à états
        this.stateMachine = new MeetingStateMachine({
            provider: this.provider,
            meetingHandle: this,
        })
    }

    public getStartTime(): number {
        return this.stateMachine.getStartTime()
    }

    public getState(): MeetingStateType {
        return this.stateMachine.getCurrentState()
    }

    public updateParticipantState(state: ParticipantState): void {
        if (this.stateMachine) {
            this.stateMachine.updateParticipantState(state)
        }
    }

    public getError(): Error | null {
        return this.stateMachine.getError()
    }

    public async startRecordMeeting(): Promise<void> {
        try {
            await this.stateMachine.start()

            // Check if an error occurred during execution
            if (
                this.stateMachine.getError() ||
                this.stateMachine.getCurrentState() === MeetingStateType.Error
            ) {
                throw (
                    this.stateMachine.getError() ||
                    new Error('Recording failed to complete')
                )
            }
        } catch (error) {
            console.error('Error in startRecordMeeting:', error)
            throw error // Remonter l'erreur au niveau supérieur
        }
    }

    public async stopMeeting(reason: RecordingEndReason): Promise<void> {
        await this.stateMachine.requestStop(reason)
    }

    public wasRecordingSuccessful(): boolean {
        return this.stateMachine.wasRecordingSuccessful()
    }

    public getEndReason(): RecordingEndReason | undefined {
        return this.stateMachine.getContext().endReason
    }
}
