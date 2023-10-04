import { ChangeAgenda, ChangeLanguage } from './background'
import { MeetingProvider, Marker, Agenda } from 'spoke_api_js'

export type MeetingParams = {
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
    api_bot_baseurl: string
    session_id: string
    agenda?: Agenda
    vocabulary: string[]
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
    api_bot_baseurl: string
    session_id: string
    user_id: number
    agenda?: Agenda
    vocabulary: string[]
}

export type Preferences = {
    use_my_vocabulary: boolean
    audio_only: boolean
}

export const parameters: State = {
    preferences: {
        use_my_vocabulary: false,
        audio_only: false,
    },
    rev_vocabulary_id: undefined,
    api_server_baseurl: '',
    api_bot_baseurl: '',
    bot_name: 'spoke',
    language: 'en-US',
    markers: [],
    user_token: '',
    email: '',
    meeting_url: '',
    meeting_provider: 'Zoom',
    session_id: '',
    user_id: 0,
    agenda: undefined,
    vocabulary: [],
}

export function addMeetingParams(meetingParams: MeetingParams) {
    parameters.preferences.use_my_vocabulary = meetingParams.use_my_vocabulary
    parameters.language = meetingParams.language
    parameters.user_token = meetingParams.user_token
    parameters.bot_name = meetingParams.bot_name
    parameters.email = meetingParams.email
    parameters.meeting_url = meetingParams.meeting_url
    parameters.meeting_provider = meetingParams.meetingProvider
    parameters.api_server_baseurl = meetingParams.api_server_baseurl
    parameters.api_bot_baseurl = meetingParams.api_bot_baseurl
    parameters.session_id = meetingParams.session_id
    parameters.user_id = meetingParams.user_id
    parameters.agenda = meetingParams.agenda
    parameters.vocabulary = meetingParams.vocabulary
    console.log({ meetingParams })
    console.log({ parameters })
}

export function changeAgenda(agenda: Agenda) {
    parameters.agenda = agenda
}

export function changeLanguage(changeLanguage: ChangeLanguage) {
    parameters.preferences.use_my_vocabulary = changeLanguage.use_my_vocabulary
    parameters.language = changeLanguage.language
    console.log('setting language to: ', changeLanguage.language)
}

export function markMoment(marker: Marker) {
    parameters.markers.push(marker)
}
