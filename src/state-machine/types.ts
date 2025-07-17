import { BrowserContext, Page } from '@playwright/test'
import { BrandingHandle } from '../branding'
import { SimpleDialogObserver } from '../services/dialog-observer/simple-dialog-observer'
import { Streaming } from '../streaming'
import { MeetingProviderInterface } from '../types'
import { PathManager } from '../utils/PathManager'
import { MeetingStateMachine } from './machine'

export enum MeetingStateType {
    Initialization = 'initialization',
    WaitingRoom = 'waitingRoom',
    InCall = 'inCall',
    Recording = 'recording',
    Paused = 'paused',
    Resuming = 'resuming',
    Cleanup = 'cleanup',
    Error = 'error',
    Terminated = 'terminated',
}

export enum MeetingEndReason {
    // Normal end reasons
    BotRemoved = 'botRemoved',
    NoAttendees = 'noAttendees',
    NoSpeaker = 'noSpeaker',
    RecordingTimeout = 'recordingTimeout',
    ApiRequest = 'apiRequest',

    // Error end reasons
    BotRemovedTooEarly = 'botRemovedTooEarly',
    BotNotAccepted = 'botNotAccepted',
    CannotJoinMeeting = 'cannotJoinMeeting',
    TimeoutWaitingToStart = 'timeoutWaitingToStart',
    InvalidMeetingUrl = 'invalidMeetingUrl',
    StreamingSetupFailed = 'streamingSetupFailed',
    Internal = 'internalError',
}

// Get human-readable error message from error code
export function getErrorMessageFromCode(errorCode: MeetingEndReason | string): string {
    switch (errorCode) {
        case 'botRemoved':
            return 'Bot was removed from the meeting.'
        case 'noAttendees':
            return 'No attendees joined the meeting.'
        case 'noSpeaker':
            return 'No speakers detected during recording.'
        case 'recordingTimeout':
            return 'Recording timeout reached.'
        case 'apiRequest':
            return 'Recording stopped via API request.'
        case 'botRemovedTooEarly':
            return 'Bot was removed too early; the video is too short.'
        case 'botNotAccepted':
            return 'Bot was not accepted into the meeting.'
        case 'cannotJoinMeeting':
            return 'Cannot join meeting - meeting is not reachable.'
        case 'timeoutWaitingToStart':
            return 'Timeout waiting to start recording.'
        case 'invalidMeetingUrl':
            return 'Invalid meeting URL provided.'
        case 'streamingSetupFailed':
            return 'Failed to set up streaming audio.'
        case 'internalError':
            return 'Internal error occurred during recording.'
        default:
            return 'An error occurred during recording.'
    }
}

export interface MeetingContext {
    // Références aux objets principaux
    meetingHandle: MeetingStateMachine
    provider: MeetingProviderInterface

    // Pages et contexte du navigateur
    playwrightPage?: Page
    browserContext?: BrowserContext

    // Timers et intervalles
    startTime?: number
    lastSpeakerTime?: number
    noSpeakerDetectedTime?: number

    // État de la réunion
    attendeesCount?: number
    firstUserJoined?: boolean

    // Processus et ressources
    brandingProcess?: BrandingHandle

    // PathManager
    pathManager?: PathManager

    // Recording state (Play/Pause)
    isPaused?: boolean
    pauseStartTime?: number
    totalPauseDuration?: number
    lastRecordingState?: {
        timestamp?: number
        attendeesCount?: number
        lastSpeakerTime?: number
        noSpeakerDetectedTime?: number
    }

    // Streaming
    streamingService?: Streaming

    // Speakers observation
    speakersObserver?: import('../meeting/speakersObserver').SpeakersObserver

    // HTML cleanup
    htmlCleaner?: import('../meeting/htmlCleaner').HtmlCleaner

    // Dialog observer
    dialogObserver?: SimpleDialogObserver
}

export interface StateTransition {
    nextState: MeetingStateType
    context: MeetingContext
}

export interface ParticipantState {
    attendeesCount: number
    firstUserJoined: boolean
    lastSpeakerTime?: number | null
    noSpeakerDetectedTime?: number | null
}

export type StateExecuteResult = Promise<StateTransition>
