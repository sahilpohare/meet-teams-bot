import { MeetingProvider } from './api'
import { ApiService } from './recordingServerApi'

export type SpeechToTextProvider = 'Gladia' | 'Runpod' | 'Default'

export type MeetingParams = {
    user_token: string
    user_id: number
    bot_name: string
    email: string
    meeting_url: string
    meetingProvider: MeetingProvider
    api_server_baseurl: string
    session_id: string
    vocabulary: string[]
    force_lang: boolean
    translation_lang?: string
    speech_to_text_provider?: SpeechToTextProvider
    speech_to_text_api_key?: string
    streaming_input?: string
    streaming_output?: string
    bot_uuid: string
    s3_bucket: string
    mp4_s3_path: string
    recording_mode: RecordingMode
    local_recording_server_location: string
    extra?: any
}

export type RecordingMode = 'speaker_view' | 'gallery_view' | 'audio_only'

export const parameters: MeetingParams = {} as MeetingParams

export function addMeetingParams(meetingParams: MeetingParams) {
    // Copy all keys from meetingParams input TO parameters globale variable
    Object.keys(meetingParams).forEach((key) => {
        parameters[key] = meetingParams[key]
    })
    ApiService.sendMessageToRecordingServer('LOG', parameters).catch((e) => {
        console.error('Cannot echo parameters to recording_server', e)
    })
}
