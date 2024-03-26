import { Agenda, MeetingProvider } from 'spoke_api_js'
import { ChangeLanguage } from './background'

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
    bot_id?: number
    s3_bucket: string
}

export let parameters: MeetingParams = undefined as any as MeetingParams

export function addMeetingParams(meetingParams: MeetingParams) {
    console.log({ meetingParams })
    parameters = meetingParams
}

export function changeAgenda(agenda: Agenda) {
    parameters.agenda = agenda
}

export function changeLanguage(changeLanguage: ChangeLanguage) {
    parameters.language = changeLanguage.language
    console.log('setting language to: ', changeLanguage.language)
}
