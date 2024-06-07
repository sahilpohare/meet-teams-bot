import { ChangeLanguage } from './background'
import { Agenda, MeetingProvider } from './spoke_api_js'

export type SpeechToTextProvider = 'Gladia'

export type MeetingParams = {
    language: string
    user_token: string
    user_id: number
    bot_name: string
    project_name: string
    email: string
    meeting_url: string
    meetingProvider: MeetingProvider
    api_server_baseurl: string
    api_bot_baseurl: string
    session_id: string
    agenda?: Agenda
    vocabulary: string[]
    force_lang: boolean
    translation_lang?: string
    speech_to_text?: SpeechToTextProvider
    bot_id?: string
    s3_bucket: string
    recording_mode: RecordingMode
}

export type RecordingMode = 'speaker_view' | 'galery_view' | 'audio_only'

export const parameters: MeetingParams & { detected_lang?: string } =
    {} as MeetingParams

export function addMeetingParams(meetingParams: MeetingParams) {
    console.log({ meetingParams })
    Object.keys(meetingParams).forEach((key) => {
        parameters[key] = meetingParams[key]
    })
    console.log({ parameters })
}

export function changeAgenda(agenda: Agenda) {
    parameters.agenda = agenda
}

export function changeLanguage(changeLanguage: ChangeLanguage) {
    parameters.language = changeLanguage.language
    console.log('setting language to: ', changeLanguage.language)
}
