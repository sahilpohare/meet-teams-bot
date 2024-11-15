import * as record from './record'
import { SoundStreamer } from './sound_streamer'

import { MeetingProvider, RecordingMode, sleep } from './api'

import { ApiService, setDefaultAxios } from './api'

export async function startRecording(
    local_recording_server_location: string,
    streaming_audio_frequency: number | undefined,
): Promise<number> {
    try {
        ApiService.init(local_recording_server_location)

        setDefaultAxios()
        await ApiService.sendMessageToRecordingServer(
            'LOG',
            'FROM_EXTENSION: ************ Start recording launched. ************',
        )
        await sleep(1000)
        await record.initMediaRecorder(local_recording_server_location, streaming_audio_frequency)
        return await record.startRecording()
    } catch (e) {
        console.log('ERROR while start recording', JSON.stringify(e))
        throw e
    }
}

// Launch observeSpeakers.js() script inside web page DOM (Meet, teams ...)
export function start_speakers_observer(
    recording_mode: RecordingMode,
    bot_name: string,
    meetingProvider: MeetingProvider,
) {
    chrome.tabs.executeScript(
        {
            code: `var RECORDING_MODE = ${JSON.stringify(
                recording_mode,
            )}; var BOT_NAME = ${JSON.stringify(
                bot_name,
            )}; var MEETING_PROVIDER=${JSON.stringify(meetingProvider)}`,
        },
        function () {
            chrome.tabs.executeScript({
                file: './js/observeSpeakers.js',
            })
        },
    )
}

export async function stopMediaRecorder() {
    await record.stop()
}

// Stop the Audio Recording
export async function stopAudioStreaming() {
    SoundStreamer.instance?.stop()
}

export async function waitForUpload() {
    await record.waitUntilComplete().catch((e) => {
        console.error('error in waitUntilComplete', e)
        throw e
    })
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

setUserAgent(
    window,
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
)

const w = window as any
w.startRecording = startRecording
w.stopMediaRecorder = stopMediaRecorder
w.waitForUpload = waitForUpload
w.stopAudioStreaming = stopAudioStreaming
w.start_speakers_observer = start_speakers_observer
