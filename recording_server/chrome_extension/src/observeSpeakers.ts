import * as R from 'ramda'
import * as MeetProvider from './observeSpeakers/meet'
import * as TeamsProvider from './observeSpeakers/teams'

import { sleep } from './api'
import { ApiService } from './recordingServerApi'
import { parameters } from './state'

export type SpeakerData = {
    name: string
    id: number
    timestamp: number
    isSpeaking: boolean
}

declare var BOT_NAME: string
declare var MEETING_PROVIDER: string
declare var RECORDING_MODE: RecordingMode
export type RecordingMode = 'speaker_view' | 'gallery_view' | 'audio_only'

const INACTIVITY_THRESHOLD = 60 * 1000 * 30 //ms
// let inactivityCheckInterval: NodeJS.Timeout | null = null

const SPEAKERS: SpeakerData[] = []

type Provider = {
    getSpeakerFromDocument: any
    removeShityHtml: any,
    getSpeakerRootToObserve: any,
    findAllAttendees: any,
    removeInitialShityHtml: any,
    MIN_SPEAKER_DURATION: Number,
    SPEAKER_LATENCY: Number,
}

let PROVIDER: Provider | null = null

setMeetingProvider()
observeSpeakers()

function setMeetingProvider() {
    if (MEETING_PROVIDER === 'Teams') {
        PROVIDER = {
            getSpeakerFromDocument: TeamsProvider.getSpeakerFromDocument,
            removeShityHtml: TeamsProvider.removeShityHtml,
            getSpeakerRootToObserve: TeamsProvider.getSpeakerRootToObserve,
            findAllAttendees: TeamsProvider.findAllAttendees,
            removeInitialShityHtml: TeamsProvider.removeInitialShityHtml,
            MIN_SPEAKER_DURATION: TeamsProvider.MIN_SPEAKER_DURATION,
            SPEAKER_LATENCY: TeamsProvider.SPEAKER_LATENCY,
        }
    } else if (MEETING_PROVIDER === 'Meet') {
        PROVIDER = {
            getSpeakerFromDocument: MeetProvider.getSpeakerFromDocument,
            removeShityHtml: MeetProvider.removeShityHtml,
            getSpeakerRootToObserve: MeetProvider.getSpeakerRootToObserve,
            findAllAttendees: MeetProvider.findAllAttendees,
            removeInitialShityHtml: MeetProvider.removeInitialShityHtml,
            MIN_SPEAKER_DURATION: MeetProvider.MIN_SPEAKER_DURATION,
            SPEAKER_LATENCY: MeetProvider.SPEAKER_LATENCY,
        }
    } else {
        PROVIDER = null
    }
}

// Refresh the number of participants
async function refreshAttendeesLoop() {
    if (MEETING_PROVIDER === 'Zoom') {
        console.info('ZOOM refresh Attendees is not handled by the Extension!')
        return
    }
    while (true) {
        try {
            const allAttendees = R.filter(
                (attendee: string) =>
                    attendee != BOT_NAME &&
                    !attendee.toLowerCase().includes('notetaker'),
                PROVIDER?.findAllAttendees(),
            )
            console.log('refresh participants loop', allAttendees)
            chrome.runtime.sendMessage({
                type: 'REFRESH_ATTENDEES',
                payload: allAttendees,
            })
        } catch (e) {
            console.error('an exception occurred in refresh attendees', e)
        }
        await sleep(10000)
    }
}

async function removeShityHtmlLoop(mode: RecordingMode) {
    while (true) {
        PROVIDER?.removeShityHtml(mode)
        await sleep(1000)
    }
}

// Observe Speakers mutation
async function observeSpeakers() {
    if (MEETING_PROVIDER === 'Zoom') {
        console.info('ZOOM observation speackers is not handled by the Extension!')
        return
    } else {
        console.log('start observe speakers', RECORDING_MODE)
    }
    try {
        removeShityHtmlLoop(RECORDING_MODE)
        refreshAttendeesLoop()
        checkInactivity()
    } catch (e) {
        console.log('an exception occurred in remove shitty html', e)
    }

    var mutationObserver = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
            if (parameters.meetingProvider === 'Teams') {
                PROVIDER?.removeShityHtml(RECORDING_MODE)
            }
            try {
                const currentSpeakersList = PROVIDER?.getSpeakerFromDocument(
                    SPEAKERS.length > 0
                        ? SPEAKERS[SPEAKERS.length - 1].name
                        : null,
                    mutation,
                    RECORDING_MODE,
                )
                if (currentSpeakersList.length > 0) {
                    ApiService.sendMessageToRecordingServer(
                        'LOG_SPEAKER',
                        currentSpeakersList,
                    ).catch((e) => {
                        console.error(
                            'error LOG_SPEAKER FROM EXTENSION in observeSpeaker',
                            e,
                        )
                    })
                }

                // New logic for Meet and Teams
                const activeSpeakers = currentSpeakersList.filter(
                    (s) => s.isSpeaking,
                )
                // si lazare parle,  si Philippe se met a parler en meme temps
                // philippe prend forcement la precedence
                const newActiveSpeakers = activeSpeakers.filter(
                    (s) =>
                        s.name !== BOT_NAME &&
                        (SPEAKERS.length === 0 ||
                            s.name !== SPEAKERS[SPEAKERS.length - 1].name),
                )
                // essayer de gerer MIN DURATION ICI ?
                //  && Date.now() - s.timestamp >
                //     PROVIDER.MIN_SPEAKER_DURATION)),

                if (newActiveSpeakers.length > 0) {
                    // TODO: not handling multiple speakers in the same time
                    const newSpeaker = newActiveSpeakers[0]
                    SPEAKERS.push(newSpeaker)
                    console.log('speaker changed to: ', newSpeaker)
                    chrome.runtime.sendMessage({
                        type: 'REFRESH_SPEAKERS',
                        payload: SPEAKERS,
                    })
                }
            } catch (e) {
                console.error('an exception occurred in observeSpeaker', e)
                console.log('an exception occurred in observeSpeaker', e)
            }
        })
    })

    try {
        const currentSpeakersList = R.filter(
            (u: SpeakerData) => u.name !== BOT_NAME && u.isSpeaking == true,
            PROVIDER?.getSpeakerFromDocument(null, null, RECORDING_MODE),
        )

        const speaker = currentSpeakersList[0]
        if (speaker) {
            SPEAKERS.push(speaker)
            ApiService.sendMessageToRecordingServer(
                'LOG',
                `[ObserveSpeaker] initial speakers ${
                    SPEAKERS[SPEAKERS.length - 1]
                }`,
            ).catch((e) => {
                console.error('error LOG FROM EXTENSION in observeSpeaker', e)
            })
            ApiService.sendMessageToRecordingServer(
                'LOG_SPEAKER',
                currentSpeakersList,
            ).catch((e) => {
                console.error(
                    'error LOG_SPEAKER FROM EXTENSION in observeSpeaker',
                    e,
                )
            })

            chrome.runtime.sendMessage({
                type: 'REFRESH_SPEAKERS',
                payload: SPEAKERS,
            })
        } else {
            SPEAKERS.push({
                name: '-',
                id: 0,
                timestamp: Date.now(),
                isSpeaking: true,
            })
            chrome.runtime.sendMessage({
                type: 'REFRESH_SPEAKERS',
                payload: SPEAKERS,
            })
            ApiService.sendMessageToRecordingServer(
                'LOG',
                `[ObserveSpeaker] no initial speakers ${
                    SPEAKERS[SPEAKERS.length - 1]
                }`,
            ).catch((e) => {
                console.error('error LOG FROM EXTENSION in observeSpeaker', e)
            })
            ApiService.sendMessageToRecordingServer(
                'LOG_SPEAKER',
                SPEAKERS,
            ).catch((e) => {
                console.error(
                    'error LOG_SPEAKER FROM EXTENSION in observeSpeaker',
                    e,
                )
            })
        }
    } catch (e) {
        console.error('an exception occurred starting observeSpeaker')
    }

    try {
        await PROVIDER?.removeInitialShityHtml(RECORDING_MODE)
        await PROVIDER?.getSpeakerRootToObserve(mutationObserver, RECORDING_MODE)
    } catch (e) {
        console.error('an exception occurred starting observeSpeaker')
    }
}

async function checkInactivity() {
    while (true) {
        await sleep(1000)
        if (SPEAKERS.length === 0) {
            console.error('Cannot happen : SPEAKERS.length must be almost 1')
            continue
        }
        let speaker = SPEAKERS[SPEAKERS.length - 1]
        let last_timestamp = speaker.timestamp

        console.log('checking inactivity', last_timestamp)

        if (Date.now() - last_timestamp > INACTIVITY_THRESHOLD) {
            console.error('[wordPosterWorker] Meuh y a que des bots!!!')
            console.warn('Unusual Inactivity Detected')
            ApiService.sendMessageToRecordingServer('STOP_MEETING', {
                reason: 'Unusual Inactivity Detected',
            }).catch((e) => {
                console.error(
                    'error STOP_MEETING FROM EXTENSION in observeSpeaker',
                    e,
                )
            })
        }
    }
}
