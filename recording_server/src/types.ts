import { Browser, Page } from 'puppeteer'

export type MeetingStatus = 'Recording' | 'Cleanup' | 'Done'

export type Meeting = {
    page: Page
    backgroundPage: Page
    browser: Browser
    meetingTimeoutInterval: NodeJS.Timeout
}
export type Session = {
    meeting_url: string
    user_id: number
}

export type StatusParams = {
    meeting_url: string
    user_id: number
}

export type RecordingMode = 'speaker_view' | 'gallery_view' | 'audio_only'

export interface MeetingProviderInterface {
    openMeetingPage(browser: Browser, link: string): Promise<Page>

    joinMeeting(
        page: Page,
        cancelCheck: () => boolean,
        meetingParams: MeetingParams,
    ): Promise<void>
    findEndMeeting(
        meetingParams: MeetingParams,
        page: Page,
        cancellationToken: CancellationToken,
    ): Promise<boolean>
    parseMeetingUrl(
        browser: Browser,
        meeting_url: string,
    ): Promise<{ meetingId: string; password: string }>
    getMeetingLink(
        meeting_id: string,
        _password: string,
        _role: number,
        _bot_name: string,
        _enter_message?: string,
    ): string
}

export type SpeechToTextProvider = 'Gladia'

export type MeetingParams = {
    use_my_vocabulary: boolean
    language: string
    meeting_url: string
    user_token: string
    bot_name: string
    project_name: string
    user_id: number
    session_id: string
    email: string
    meetingProvider: MeetingProvider
    event?: { id: number }
    agenda?: any
    bot_branding: boolean
    has_installed_extension: boolean
    custom_branding_bot_path?: string
    vocabulary: string[]
    force_lang: boolean
    translation_lang?: string
    speech_to_text?: SpeechToTextProvider
    bot_id?: string
    enter_message?: string
    bots_api_key?: string
    bots_webhook_url?: string
    recording_mode: RecordingMode
    local_recording_server_location: string
    automatic_leave: {
        // The number of seconds after which the bot will automatically leave the call, if it has not been let in from the waiting room.
        waiting_room_timeout: number
        // The number of seconds after which the bot will automatically leave the call, if it has joined the meeting but no other participant has joined.
        noone_joined_timeout: number
        // The number of seconds after which the bot will automatically leave the call, if there were other participants in the call who have all left.
        // everyone_left_timeout?: number
        // The number of seconds after which the bot will automatically leave the call, if it has joined the call but not started recording.
        // in_call_not_recording_timeout?: number
        // The number of seconds after which the bot will automatically leave the call, if it has joined the call and started recording it. This can be used to enforce a maximum recording time limit for a bot. There is no default value for this parameter, meaning a bot will continue to record for as long as the meeting lasts.
        // in_call_recording_timeout?: number
        // The number of seconds after which the bot will automatically leave the call, if it has joined the call but has not started recording. For e.g This can occur due to bot being denied permission to record(Zoom meetings).
        // recording_permission_denied_timeout?: number
    }
}

export class CancellationToken {
    isCancellationRequested: boolean
    timeInSec: number
    timeout: NodeJS.Timeout
    constructor(timeInSec: number) {
        this.isCancellationRequested = false
        this.timeInSec = timeInSec
        this.timeout = setTimeout(() => this.cancel(), this.timeInSec * 1000)
    }
    cancel() {
        this.isCancellationRequested = true
    }
    reset() {
        clearTimeout(this.timeout)
        this.timeout = setTimeout(() => this.cancel(), this.timeInSec * 1000)
    }
}

export type ChangeAgendaRequest = {
    agenda_id: number
}

export type ChangeLanguage = {
    meeting_url: string
    use_my_vocabulary: boolean
    language: string
    user_id: number
}

export type StopRecordParams = {
    meeting_url: string
    user_id: number
}

export type MessageToBroadcast = {
    message_type: string
    data: object
}

export type MeetingProvider = 'Zoom' | 'Meet' | 'Teams'

export type Speaker = {
    isSpeaking: boolean
    name: string
    timestamp: number
}