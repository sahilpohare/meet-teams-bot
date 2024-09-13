import * as record from './record'
import * as State from './state'
import { SoundStreamer } from './sound_streamer'

import { Project, SpokeApiConfig, api, setConfig, sleep } from './api'

import axios from 'axios'
import { SpeakerData } from './observeSpeakers'
import { ApiService } from './recordingServerApi'
import { Transcriber } from './Transcribe/Transcriber'
import { uploadEditorsTask } from './uploadEditors'

export let SPEAKERS: SpeakerData[] = []
export let ATTENDEES: string[] = []
let LAST_SPEAKER_ACTIVITY: number = Date.now()

export * from './state'

const INACTIVITY_THRESHOLD = 60 * 1000 * 30 // ms
const CHECK_INACTIVITY_PERIOD = 60 * 1000

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
    // console.log(`EXTENSION BACKGROUND PAGE - ADD SPEAKER : ${speaker}`)
    LAST_SPEAKER_ACTIVITY = speaker.timestamp
    SPEAKERS.push(speaker)
    uploadEditorsTask()
}

function updateLastSpeakerActivity(timestamp: number) {
    // console.log(`EXTENSION BACKGROUND PAGE - UPDATE TS : ${timestamp}`)
    LAST_SPEAKER_ACTIVITY = timestamp
}

// Check speakers inactivity
async function checkInactivity(): Promise<number> {
    while (true) {
        await sleep(CHECK_INACTIVITY_PERIOD)
        if (Date.now() - LAST_SPEAKER_ACTIVITY > INACTIVITY_THRESHOLD) {
            console.warn('[wordPosterWorker] Meuh y a que des bots!!!')
            ApiService.sendMessageToRecordingServer('STOP_MEETING', {
                reason: 'Unusual Inactivity Detected',
            })
                .then((_) => {
                    return 42
                })
                .catch((e) => {
                    console.error(
                        'error STOP_MEETING FROM EXTENSION in background.ts',
                        e,
                    )
                })
        }
    }
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

// Launch observeSpeakers.js() script inside web page DOM (Meet, teams ...)
function observeSpeakers() {
    chrome.tabs.executeScript(
        {
            code: `var RECORDING_MODE = ${JSON.stringify(
                State.parameters.recording_mode,
            )}; var BOT_NAME = ${JSON.stringify(
                State.parameters.bot_name,
            )}; var MEETING_PROVIDER=${JSON.stringify(
                State.parameters.meetingProvider,
            )}`,
        },
        function () {
            chrome.tabs.executeScript({ file: './js/observeSpeakers.js' })
        },
    )
}

// make startRecording accessible from puppeteer
// Start recording the current tab
export async function startRecording(
    meetingParams: State.MeetingParams,
): Promise<Project | undefined> {
    try {
        State.addMeetingParams(meetingParams)

        addDefaultHeader('Authorization', State.parameters.user_token)
        let axios_config: SpokeApiConfig = {
            api_server_internal_url: State.parameters.api_server_baseurl,
            api_bot_internal_url: State.parameters.api_bot_baseurl,
            authorizationToken: State.parameters.user_token,
            logError: () => {},
        }
        setConfig(axios_config)
        ApiService.init(meetingParams.local_recording_server_location)
        await ApiService.sendMessageToRecordingServer(
            'LOG',
            'FROM_EXTENSION: ************ Start recording launched. ************',
        )
        observeSpeakers()
        checkInactivity().then((n) => {
            console.log(
                `${n} is the answer to the ultimate question of life, the universe, and everything.`,
            )
        })
        await sleep(1000)
        await record.initMediaRecorder()
        const project = await record.startRecording(
            meetingParams.project_name,
            meetingParams.agenda,
        )
        return project
    } catch (e) {
        console.log('ERROR while start recording', JSON.stringify(e))
    }
}

export async function stopMediaRecorder() {
    await record.stop()
    // add a last fake speaker to trigger the upload of the last editor ( generates an interval )
    SPEAKERS.push({
        name: 'END',
        id: 0,
        timestamp: Date.now(),
        isSpeaking: false,
    })
    await uploadEditorsTask()
    console.log('stopping transcriber')
}

// Stop the Audio Recording
export async function stopAudioStreaming() {
    SoundStreamer.instance.stop()
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

    if (record.SESSION?.project.id != null) {
        try {
            await api.endMeetingTrampoline(
                record.SESSION.project.id,
                State.parameters.bot_id,
            )
        } catch (e) {
            console.error('error in endMeetingTranpoline', e)
        }
    }
}

const w = window as any
w.addSpeaker = addSpeaker
w.updateLastSpeakerActivity = updateLastSpeakerActivity
w.startRecording = startRecording
w.stopMediaRecorder = stopMediaRecorder
w.waitForUpload = waitForUpload
w.stopAudioStreaming = stopAudioStreaming

addListener()
