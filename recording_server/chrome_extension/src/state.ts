import { ChangeLanguage } from './background'
import { MeetingProvider, Marker, Agenda } from 'spoke_api_js'

export type MeetingParams = {
    human_transcription: boolean
    use_my_vocabulary: boolean
    language: string
    user_token: string
    user_id: number
    bot_name: string
    project_name: string
    email: string
    meeting_url: string
    meetingProvider: MeetingProvider
    api_server_baseurl: string
    api_download_baseurl: string
    api_session_id: string
    rev_api_key: string
    agenda?: Agenda
}

export type State = {
    preferences: Preferences
    rev_vocabulary_id?: string
    language: string
    markers: Marker[]
    user_token: string
    bot_name: string
    email: string
    meeting_url: string
    meeting_provider: MeetingProvider
    api_server_baseurl: string
    api_download_baseurl: string
    api_session_id: string
    rev_api_key: string
    user_id: number
    agenda?: Agenda
}

export type Preferences = {
    human_transcription: boolean
    use_my_vocabulary: boolean
    audio_only: boolean
}

export const parameters: State = {
    preferences: {
        human_transcription: false,
        use_my_vocabulary: false,
        audio_only: false,
    },
    rev_vocabulary_id: undefined,
    api_server_baseurl: '',
    api_download_baseurl: '',
    bot_name: 'spoke',
    language: 'en-US',
    markers: [],
    user_token: '',
    email: '',
    meeting_url: '',
    meeting_provider: 'Zoom',
    api_session_id: '',
    rev_api_key: '',
    user_id: 0,
    agenda: undefined,
}

export function addMeetingParams(meetingParams: MeetingParams) {
    parameters.preferences.human_transcription =
        meetingParams.human_transcription
    parameters.preferences.use_my_vocabulary = meetingParams.use_my_vocabulary
    parameters.language = meetingParams.language
    parameters.user_token = meetingParams.user_token
    parameters.bot_name = meetingParams.bot_name
    parameters.email = meetingParams.email
    parameters.meeting_url = meetingParams.meeting_url
    parameters.meeting_provider = meetingParams.meetingProvider
    parameters.api_server_baseurl = meetingParams.api_server_baseurl
    parameters.api_download_baseurl = meetingParams.api_download_baseurl
    parameters.api_session_id = meetingParams.api_session_id
    parameters.rev_api_key = meetingParams.rev_api_key
    parameters.user_id = meetingParams.user_id
    parameters.agenda = meetingParams.agenda
    console.log({ meetingParams })
    console.log({ parameters })
}

export function changeLanguage(changeLanguage: ChangeLanguage) {
    parameters.preferences.human_transcription =
        changeLanguage.human_transcription
    parameters.preferences.use_my_vocabulary = changeLanguage.use_my_vocabulary
    parameters.language = changeLanguage.language
    console.log('setting language to: ', changeLanguage.language)
}

export function markMoment(marker: Marker) {
    parameters.markers.push(marker)
}
