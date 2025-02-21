import { MeetingParams } from '../types'

import { BrowserContext, Page } from '@playwright/test'
import { BrandingHandle } from '../branding'
import { MeetingHandle } from '../meeting'
import { MeetingProviderInterface } from '../types'

export enum MeetingStateType {
    Initialization = 'initialization',
    WaitingRoom = 'waitingRoom',
    InCall = 'inCall',
    Recording = 'recording',
    Cleanup = 'cleanup',
    Error = 'error',
}

export interface MeetingContext {
    // Références aux objets principaux
    meetingHandle: MeetingHandle
    params: MeetingParams
    provider: MeetingProviderInterface

    // Pages et contexte du navigateur
    playwrightPage?: Page
    backgroundPage?: Page
    browserContext?: BrowserContext

    // Timers et intervalles
    meetingTimeoutInterval?: NodeJS.Timeout
    startTime?: number
    lastSpeakerTime?: number
    noSpeakerDetectedTime?: number

    // État de la réunion
    attendeesCount?: number
    firstUserJoined?: boolean

    // Processus et ressources
    brandingProcess?: BrandingHandle
    mediaRecorderActive?: boolean

    // Gestion des erreurs et statut
    error?: Error
    endReason?: string
    retryCount?: number

    // Identifiants et tokens
    extensionId?: string
    meetingId?: string
    meetingPassword?: string
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
