import { MeetingEndReason } from './state-machine/types'
import { JoinError, MeetingParams } from './types'

class Global {
    private static instance: Global
    private meetingParams: MeetingParams | null = null
    private currentError: JoinError | null = null
    private endReason: MeetingEndReason | null = null
    public constructor() {}

    public set(meetingParams: MeetingParams) {
        if (this.meetingParams !== null) {
            throw new Error('Meeting params are already set')
        }

        // Validate critical parameters before setting them
        if (
            !meetingParams.meeting_url ||
            meetingParams.meeting_url.trim() === ''
        ) {
            throw new Error('Missing required parameter: meeting_url')
        }
        if (!meetingParams.bot_uuid || meetingParams.bot_uuid.trim() === '') {
            throw new Error('Missing required parameter: bot_uuid')
        }

        this.meetingParams = meetingParams
        console.log(
            `🤖 Bot ${meetingParams.bot_uuid} initialized with validated parameters`,
        )
    }

    public get(): MeetingParams {
        if (this.meetingParams === null) {
            throw new Error('Meeting params are not set')
        }
        return this.meetingParams
    }

    public isServerless(): boolean {
        if (this.meetingParams === null) {
            throw new Error('Meeting params are not set')
        }
        return this.meetingParams.remote === null
    }

    public setError(error: JoinError): void {
        console.log(`🔴 Setting global error: ${error.reason}`)
        this.currentError = error
        this.endReason = error.reason
        console.log(`🔴 End reason set to: ${this.endReason}`)
    }

    public setEndReason(reason: MeetingEndReason): void {
        console.log(`🔵 Setting global end reason: ${reason}`)
        this.endReason = reason
    }

    public getError(): JoinError | null {
        return this.currentError
    }

    public getEndReason(): MeetingEndReason | null {
        return this.endReason
    }

    public hasError(): boolean {
        return this.currentError !== null
    }

    public clearError(): void {
        this.currentError = null
        this.endReason = null
    }
}

export let GLOBAL = new Global()
