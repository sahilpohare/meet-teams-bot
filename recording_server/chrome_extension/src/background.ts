import axios from 'axios'
import { Note, Project, api, setConfig } from 'spoke_api_js'
import { Transcriber } from './Transcribe/Transcriber'
import * as record from './record'
import * as State from './state'
import { sleep } from './utils'

type Speaker = {
    name: string
    timestamp: number
}

addListener()
export let SPEAKERS: Speaker[] = []
export let ATTENDEES: string[] = []

export * from './state'

export function addDefaultHeader(name: string, value: string) {
    axios.defaults.headers.common[name] = value
}

function setUserAgent(window, userAgent) {
    // Works on Firefox, Chrome, Opera and IE9+
    if ((navigator as any).__defineGetter__) {
        ;(navigator as any).__defineGetter__('userAgent', function () {
            return userAgent
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
            window.navigator = Object.create(navigator, {
                userAgent: userAgentProp,
            })
        }
    }
}
setUserAgent(
    window,
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
)

function addListener() {
    chrome.runtime.onMessage.addListener(function (
        request,
        _sender,
        _sendResponse,
    ) {
        switch (request.type) {
            case 'REFRESH_ATTENDEES': {
                if (request.payload.length > ATTENDEES.length) {
                    ATTENDEES = request.payload
                }
                break
            }
            case 'REFRESH_SPEAKERS': {
                SPEAKERS = request.payload
                break
            }
            case 'OBSERVE_SPEAKERS': {
                observeSpeakers()
                break
            }
            case 'RECORD': {
                State.parameters.language = 'en'
                record.initMediaRecorder()
                break
            }
            default: {
                console.log('UNKNOWN_REQUEST', request)
                break
            }
        }
    })
}

function observeSpeakers() {
    chrome.tabs.executeScript(
        {
            code: `var BOT_NAME = ${JSON.stringify(
                State.parameters.bot_name,
            )}; var MEETING_PROVIDER=${JSON.stringify(
                State.parameters.meeting_provider,
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

        console.log('new version', '1.1')

        addDefaultHeader('Authorization', State.parameters.user_token)
        setConfig({
            api_server_internal_url: State.parameters.api_server_baseurl,
            api_bot_internal_url: State.parameters.api_bot_baseurl,
            authorizationToken: State.parameters.user_token,
            logError: () => {},
        })

        observeSpeakers()
        await sleep(1000)
        await record.initMediaRecorder()
        const project = await record.startRecording(
            meetingParams.project_name,
            meetingParams.agenda,
        )
        return project
    } catch (e) {
        console.log('ERROR', e)
        console.log(JSON.stringify(e))
    }
    // setTimeout(() => { record.stopRecording() }, 60000)
}

export async function stopMediaRecorder() {
    await record.stop()
    await Transcriber.TRANSCRIBER?.stop()
}

export async function waitForUpload() {
    await record.waitUntilComplete()
    await Transcriber.TRANSCRIBER?.waitUntilComplete()
    // "Your video is available online"
    await record.stopRecordServer(record.SESSION)
}

export async function markMoment(
    timestamp: number,
    duration: number,
    label_id: number | undefined,
    notes?: Note[],
) {
    State.markMoment({ date: timestamp, duration, label_id, notes })
}

export type ChangeLanguage = {
    meeting_url: string
    use_my_vocabulary: boolean
    language: string
}
export type ChangeAgenda = {
    agenda_id: number
}

export async function getAgenda() {
    if (State.parameters.agenda != null) {
        return State.parameters.agenda
    } else {
        return undefined
    }
}
export async function changeAgenda(data: ChangeAgenda) {
    console.log('[changeagenda]', data)
    if (State.parameters.agenda?.id !== data.agenda_id) {
        try {
            const agenda = await api.getAgendaWithId(data.agenda_id)
            State.changeAgenda(agenda)
        } catch (e) {
            console.error('error getting agenda', e)
        }
    }
}
const w = window as any
w.startRecording = startRecording
w.markMoment = markMoment
w.stopMediaRecorder = stopMediaRecorder
w.waitForUpload = waitForUpload
w.changeAgenda = changeAgenda
w.getAgenda = getAgenda
