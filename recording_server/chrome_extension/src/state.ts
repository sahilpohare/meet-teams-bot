// TODO : language_code - 99% sure it is trash code
// import { ChangeLanguage } from './background'
import { Agenda, MeetingProvider } from './api'
import { ApiService } from './recordingServerApi'

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
    local_recording_server_location: string
}

export type RecordingMode = 'speaker_view' | 'gallery_view' | 'audio_only'

// TODO : language_code - 99% sure it is trash code
// export const parameters: MeetingParams & { detected_lang?: string } =
//     {} as MeetingParams

export const parameters: MeetingParams = {} as MeetingParams

export function addMeetingParams(meetingParams: MeetingParams) {
    ApiService.sendMessageToRecordingServer('LOG', meetingParams).catch((e) => {
        console.error('error LOG FROM EXTENSION in observeSpeaker', e)
    })
    // Copy all keys from meetingParams input TO parameters globale variable
    Object.keys(meetingParams).forEach((key) => {
        parameters[key] = meetingParams[key]
    })
}

export function changeAgenda(agenda: Agenda) {
    parameters.agenda = agenda
}

// TODO : language_code - 99% sure it is trash code
// export function changeLanguage(changeLanguage: ChangeLanguage) {
//     parameters.language = changeLanguage.language
//     console.log('setting language to: ', changeLanguage.language)
// }
