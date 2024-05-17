import * as State from './state'
import * as record from './record'

import { Project, api, setConfig } from './spoke_api_js'

import { Transcriber } from './Transcribe/Transcriber'
import axios from 'axios'
import { sleep } from './utils'
import { uploadEditorsTask } from './uploadEditors'

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
                const prevSpeakers = SPEAKERS
                SPEAKERS = request.payload
                if (SPEAKERS.length > prevSpeakers.length) {
                    console.log('new speaker, pushing complete editor')
                    uploadEditorsTask(SPEAKERS)
                }
                break
            }
            case 'LOG': {
                console.log(request.payload)
            }
            case 'OBSERVE_SPEAKERS': {
                observeSpeakers()
                break
            }
            case 'RECORD': {
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
        console.log('ERROR while start recording', JSON.stringify(e))
    }
    // setTimeout(() => { record.stopRecording() }, 60000)
}

export async function stopMediaRecorder() {
    await record.stop()
    const timestamp = new Date().getTime()
    // add a last fake speaker to trigger the upload of the last editor ( generates an interval )
    SPEAKERS.push({ name: 'END', timestamp })
    await uploadEditorsTask(SPEAKERS)

    console.log('stoping transcriber')
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
                record.SESSION?.project.id,
                State.parameters.bot_id,
            )
        } catch (e) {
            console.error('error in endMeetingTranpoline', e)
        }
    }
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
w.stopMediaRecorder = stopMediaRecorder
w.waitForUpload = waitForUpload
w.changeAgenda = changeAgenda
w.getAgenda = getAgenda
