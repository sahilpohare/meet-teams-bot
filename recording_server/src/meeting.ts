import { LOCAL_RECORDING_SERVER_LOCATION } from './instance'
import { MeetingParams, MeetingProviderInterface, MeetingStatus } from './types'

// import { Browser as PuppeteerBrowser, Page as PuppeteerPage } from 'puppeteer'
import { MeetProvider } from './meeting/meet'
import { TeamsProvider } from './meeting/teams'
import { MeetingStateMachine } from './state-machine/machine'
import { MeetingStateType, ParticipantState } from './state-machine/types'

let _NO_SPEAKER_DETECTED_TIMESTAMP: number | null = null
export const NO_SPEAKER_DETECTED_TIMESTAMP = {
    get: () => _NO_SPEAKER_DETECTED_TIMESTAMP,
    set: (value: number | null) => {
        _NO_SPEAKER_DETECTED_TIMESTAMP = value
    },
}
let _START_RECORDING_TIMESTAMP: number | null = null
export const START_RECORDING_TIMESTAMP = {
    get: () => _START_RECORDING_TIMESTAMP,
    set: (value: number | null) => {
        _START_RECORDING_TIMESTAMP = value
    },
}

let _NUMBER_OF_ATTENDEES: number | null = null
export const NUMBER_OF_ATTENDEES = {
    get: () => _NUMBER_OF_ATTENDEES,
    set: (value: number | null) => {
        _NUMBER_OF_ATTENDEES = value
    },
}

let _FIRST_USER_JOINED: boolean = false
export const FIRST_USER_JOINED = {
    get: () => _FIRST_USER_JOINED,
    set: (value: boolean) => {
        _FIRST_USER_JOINED = value
    },
}

const NO_SPEAKER_THRESHOLD = 1000 * 60 * 7 // 7 minutes
const NO_SPEAKER_DETECTED_TIMEOUT = 1000 * 60 * 15 // 15 minutes
const RECORDING_TIMEOUT = 3600 * 4 * 1000 // 4 hours

const CHUNK_DURATION: number = 10_000 // 10 seconds for each chunks
const TRANSCRIBE_DURATION: number = CHUNK_DURATION * 18 // 3 minutes for each transcribe

const MAX_RETRIES = 3

const FIND_END_MEETING_SLEEP = 250

export class Status {
    state: MeetingStatus
    error: any | null
    constructor() {
        this.state = 'Recording'
        console.error = null
    }
}

export class MeetingHandle {
    static instance: MeetingHandle = null
    private stateMachine: MeetingStateMachine
    private param: MeetingParams
    private provider: MeetingProviderInterface

    static init(meetingParams: MeetingParams) {
        if (MeetingHandle.instance == null) {
            this.instance = new MeetingHandle(meetingParams)
            console.log(
                '*** INIT MeetingHandle.instance',
                meetingParams.meeting_url,
            )
        }
    }

    constructor(meetingParams: MeetingParams) {
        this.param = meetingParams
        this.provider =
            meetingParams.meetingProvider === 'Teams'
                ? new TeamsProvider()
                : new MeetProvider()

        // Configuration initiale
        this.param.local_recording_server_location =
            LOCAL_RECORDING_SERVER_LOCATION
        this.param.recording_mode =
            this.param.recording_mode === 'gallery_view'
                ? 'speaker_view'
                : this.param.recording_mode

        // Initialisation de la machine à états
        this.stateMachine = new MeetingStateMachine({
            params: this.param,
            provider: this.provider,
            meetingHandle: this,
        })
    }

    static getUserId(): number | null {
        return MeetingHandle.instance.param.user_id
    }

    static getBotId(): string {
        return MeetingHandle.instance.param.bot_uuid
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
        await this.stateMachine.start()
    }

    public async stopMeeting(reason: string = 'manual_stop'): Promise<void> {
        await this.stateMachine.requestStop(reason)
    }

    public getProvider(): MeetingProviderInterface {
        return this.provider
    }

    public getParams(): MeetingParams {
        return this.param
    }
}
