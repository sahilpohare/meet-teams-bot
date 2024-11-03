import * as record from './record'
import { SoundStreamer } from './sound_streamer'
import * as State from './state'

import { SpokeApiConfig, api, setConfig, sleep } from './api'

import axios from 'axios'
import { SpeakerData } from './observeSpeakers'
import { ApiService } from './recordingServerApi'
import { Transcriber } from './Transcribe/Transcriber'
import { uploadTranscriptTask } from './uploadTranscripts'

export let ATTENDEES: string[] = []

export * from './state'

export function addDefaultHeader(name: string, value: string) {
    axios.defaults.headers.common[name] = value
}

function setUserAgent(window: Window, userAgent: string) {
    // Works on Firefox, Chrome, Opera and IE9+
    if ((navigator as any).__defineGetter__) {
        Object.defineProperty(navigator, 'userAgent', {
            get: function () {
                return userAgent
            },
        })
    } else if (Object.defineProperty) {
        Object.defineProperty(navigator, 'userAgent', {
            get: function () {
                return userAgent
            },
        })
    }
    // Works on Safari
    if (window.navigator.userAgent !== userAgent) {
        const userAgentProp = {
            get: function () {
                return userAgent
            },
        }
        try {
            Object.defineProperty(window.navigator, 'userAgent', userAgentProp)
        } catch (e) {
            console.warn('Failed to set userAgent', e)
        }
    }
}

// IMPORTANT : For reasons of current compatibility, this function is only called
// with a single speaker and not an array of multiple speakers. Handling multiple
// speakers should be implemented at some point.
function addSpeaker(speaker: SpeakerData) {
    // console.log('EXTENSION BACKGROUND PAGE - ADD SPEAKER :', speaker)
    uploadTranscriptTask(speaker, false)
}

setUserAgent(
    window,
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
)

// IMPORTANT : chrome.runtime methods are only used by Spoke. MeetingBaas prefers AXIOS
function addListener() {
    chrome.runtime.onMessage.addListener(function (
        request: any,
        _sender: chrome.runtime.MessageSender,
        _sendResponse: (response?: any) => void,
    ) {
        switch (request.type) {
            // IMPORTANT : REFRESH_ATTENDEES -> Necessary to Spoke 'summarizeWorker.ts'
            case 'REFRESH_ATTENDEES':
                if (request.payload.length > ATTENDEES.length) {
                    ATTENDEES = request.payload
                }
                break
            default:
                console.log('UNKNOWN_REQUEST', request)
                break
        }
    })
}

// make startRecording accessible from puppeteer
// Start recording the current tab
export async function startRecording(
    meetingParams: State.MeetingParams,
): Promise<void> {
    try {
        ApiService.init(meetingParams.local_recording_server_location)
        State.addMeetingParams(meetingParams)

        addDefaultHeader('Authorization', State.parameters.user_token)
        let axios_config: SpokeApiConfig = {
            api_server_internal_url: State.parameters.api_server_baseurl,
            api_bot_internal_url: State.parameters.api_bot_baseurl,
            authorizationToken: State.parameters.user_token,
            logError: () => {},
        }
        setConfig(axios_config)
        await ApiService.sendMessageToRecordingServer(
            'LOG',
            'FROM_EXTENSION: ************ Start recording launched. ************',
        )
        await sleep(1000)
        await record.initMediaRecorder(meetingParams.streaming_output)
        await record.startRecording()
    } catch (e) {
        console.log('ERROR while start recording', JSON.stringify(e))
    }
}

export async function stopMediaRecorder() {
    await record.stop()
    // add a last fake speaker to trigger the upload of the last editor ( generates an interval )
    await uploadTranscriptTask(
        {
            name: 'END',
            id: 0,
            timestamp: Date.now(),
            isSpeaking: false,
        } as SpeakerData,
        true,
    )
}

// Stop the Audio Recording
export async function stopAudioStreaming() {
    SoundStreamer.instance?.stop()
}

export async function waitForUpload() {
    await record.waitUntilComplete()
    await Transcriber.TRANSCRIBER?.stop()
    await Transcriber.TRANSCRIBER?.waitUntilComplete()

    try {
        await record.stopRecordServer(record.SESSION)
    } catch (e) {
        console.error('error in stopRecordServer', e)
    }

    try {
        await api.endMeetingTrampoline(State.parameters.bot_uuid)
    } catch (e) {
        console.error('error in endMeetingTranpoline', e)
    }
}

const w = window as any
w.addSpeaker = addSpeaker
w.startRecording = startRecording
w.stopMediaRecorder = stopMediaRecorder
w.waitForUpload = waitForUpload
w.stopAudioStreaming = stopAudioStreaming

addListener()
