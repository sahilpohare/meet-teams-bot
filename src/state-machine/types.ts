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

// Map MeetingEndReason enum values to descriptive error messages (like Zoom bot)
export function mapEndReasonToMessage(endReason: MeetingEndReason): string {
    switch (endReason) {
        // Normal end reasons - these should be treated as success
        case MeetingEndReason.BotRemoved:
            return 'Bot was removed from the meeting.'
        case MeetingEndReason.NoAttendees:
            return 'Bot left because there were no more attendees.'
        case MeetingEndReason.NoSpeaker:
            return 'Bot left because no speakers were detected for too long.'
        case MeetingEndReason.RecordingTimeout:
            return 'Recording timeout reached.'
        case MeetingEndReason.ApiRequest:
            return 'Recording stopped via API request.'

        // Error end reasons - these should be treated as failures
        case MeetingEndReason.BotRemovedTooEarly:
            return 'Bot was removed from the meeting too early; the video is too short.'
        case MeetingEndReason.BotNotAccepted:
            return 'Bot was not accepted into the meeting.'
        case MeetingEndReason.CannotJoinMeeting:
            return 'Cannot join meeting - meeting is not reachable.'
        case MeetingEndReason.TimeoutWaitingToStart:
            return 'Timeout waiting to start recording.'
        case MeetingEndReason.InvalidMeetingUrl:
            return 'Invalid meeting URL provided.'
        case MeetingEndReason.StreamingSetupFailed:
            return 'Failed to set up streaming audio.'
        case MeetingEndReason.Internal:
            return 'Internal error occurred during recording.'
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
