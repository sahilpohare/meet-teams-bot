import * as R from 'ramda'
import * as MeetProvider from './observeSpeakers/meet'
import * as TeamsProvider from './observeSpeakers/teams'
import * as ZoomProvider from './observeSpeakers/zoom'

import { parameters } from './state'
import { sleep } from './utils'

export type Speaker = {
    isSpeaking: boolean
    name: string
    timestamp: number
}

declare var BOT_NAME: string
declare var MEETING_PROVIDER: string
declare var RECORDING_MODE: RecordingMode
export type RecordingMode = 'speaker_view' | 'gallery_view' | 'audio_only'

let lastSpeechTimestamp = Date.now()
// TODO : Modify it to 15 minutes
const INACTIVITY_THRESHOLD = 60 * 1000 * 1 //ms
let inactivityCheckInterval: NodeJS.Timeout | null = null

const SPEAKERS: Speaker[] = []

let PROVIDER = {
    getSpeakerFromDocument: ZoomProvider.getSpeakerFromDocument,
    removeShityHtml: ZoomProvider.removeShityHtml,
    MIN_SPEAKER_DURATION: ZoomProvider.MIN_SPEAKER_DURATION,
    SPEAKER_LATENCY: ZoomProvider.SPEAKER_LATENCY,
    getSpeakerRootToObserve: ZoomProvider.getSpeakerRootToObserve,
    findAllAttendees: ZoomProvider.findAllAttendees,
    removeInitialShityHtml: ZoomProvider.removeInitialShityHtml,
}

setMeetingProvider()
observeSpeakers()

function setMeetingProvider() {
    if (MEETING_PROVIDER === 'Teams') {
        PROVIDER = {
            getSpeakerFromDocument: TeamsProvider.getSpeakerFromDocument,
            removeShityHtml: TeamsProvider.removeShityHtml,
            MIN_SPEAKER_DURATION: TeamsProvider.MIN_SPEAKER_DURATION,
            SPEAKER_LATENCY: TeamsProvider.SPEAKER_LATENCY,
            getSpeakerRootToObserve: TeamsProvider.getSpeakerRootToObserve,
            findAllAttendees: TeamsProvider.findAllAttendees,
            removeInitialShityHtml: TeamsProvider.removeInitialShityHtml,
        }
    } else if (MEETING_PROVIDER === 'Meet') {
        PROVIDER = {
            getSpeakerFromDocument: MeetProvider.getSpeakerFromDocument,
            removeShityHtml: MeetProvider.removeShityHtml,
            MIN_SPEAKER_DURATION: MeetProvider.MIN_SPEAKER_DURATION,
            SPEAKER_LATENCY: MeetProvider.SPEAKER_LATENCY,
            getSpeakerRootToObserve: MeetProvider.getSpeakerRootToObserve,
            findAllAttendees: MeetProvider.findAllAttendees,
            removeInitialShityHtml: MeetProvider.removeInitialShityHtml,
        }
    } else {
        PROVIDER = {
            getSpeakerFromDocument: ZoomProvider.getSpeakerFromDocument,
            removeShityHtml: ZoomProvider.removeShityHtml,
            MIN_SPEAKER_DURATION: ZoomProvider.MIN_SPEAKER_DURATION,
            SPEAKER_LATENCY: ZoomProvider.SPEAKER_LATENCY,
            getSpeakerRootToObserve: ZoomProvider.getSpeakerRootToObserve,
            findAllAttendees: ZoomProvider.findAllAttendees,
            removeInitialShityHtml: ZoomProvider.removeInitialShityHtml,
        }
    }
}

async function removeShityHtmlLoop(mode: RecordingMode) {
    while (true) {
        PROVIDER.removeShityHtml(mode)
        await sleep(1000)
    }
}

async function refreshAttendeesLoop() {
    while (true) {
        try {
            const allAttendees = R.filter(
                (attendee) =>
                    attendee != BOT_NAME &&
                    !attendee.toLowerCase().includes('notetaker'),
                PROVIDER.findAllAttendees(),
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

async function observeSpeakers() {
    console.log('start observe speakers', RECORDING_MODE)
    try {
        removeShityHtmlLoop(RECORDING_MODE)
        refreshAttendeesLoop()
        checkInactivity()
    } catch (e) {
        console.log('an exception occurred in remove shitty html', e)
    }

    function refreshSpeaker(index: number) {
        console.log('timeout refresh speaker')
        let lastSpeaker = index < SPEAKERS.length ? SPEAKERS[index] : undefined
        const now = Date.now() - PROVIDER.SPEAKER_LATENCY
        const speakerDuration = now - (lastSpeaker?.timestamp ?? 0)
        if (speakerDuration > 2000) {
            chrome.runtime.sendMessage({
                type: 'REFRESH_SPEAKERS',
                payload: SPEAKERS.slice(0, index + 1),
            })
        } else {
            console.log('speaker changed in the last 2 secs')
        }
    }

    var mutationObserver = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
            if (parameters.meetingProvider === 'Teams') {
                PROVIDER.removeShityHtml(RECORDING_MODE)
            }
            try {
                const speakers = PROVIDER.getSpeakerFromDocument(
                    SPEAKERS.length > 0
                        ? SPEAKERS[SPEAKERS.length - 1].name
                        : null,
                    mutation,
                    RECORDING_MODE,
                )

                if (MEETING_PROVIDER === 'Zoom') {
                    // Existing Zoom logic
                    const previousSpeaker =
                        SPEAKERS.length > 0
                            ? SPEAKERS[SPEAKERS.length - 1]
                            : undefined
                    const speakersFiltered = R.filter(
                        (u) =>
                            u.name !== BOT_NAME &&
                            u.name !== previousSpeaker?.name,
                        speakers,
                    )
                    const speaker = speakersFiltered[0]

                    if (speaker) {
                        const newSpeaker = {
                            name: speaker.name,
                            timestamp:
                                speaker.timestamp - PROVIDER.SPEAKER_LATENCY,
                            isSpeaking: speaker.isSpeaking,
                        }
                        const speakerDuration =
                            newSpeaker.timestamp -
                            (previousSpeaker?.timestamp ?? 0)
                        if (speakerDuration < PROVIDER.MIN_SPEAKER_DURATION) {
                            SPEAKERS[SPEAKERS.length - 1] = newSpeaker
                            if (
                                SPEAKERS.length > 2 &&
                                SPEAKERS[SPEAKERS.length - 2].name ===
                                    newSpeaker.name
                            ) {
                                SPEAKERS.pop()
                            }
                            setTimeout(
                                () => refreshSpeaker(SPEAKERS.length - 1),
                                PROVIDER.MIN_SPEAKER_DURATION + 500,
                            )
                        } else {
                            chrome.runtime.sendMessage({
                                type: 'REFRESH_SPEAKERS',
                                payload: SPEAKERS,
                            })

                            SPEAKERS.push(newSpeaker)
                            if (SPEAKERS.length === 1) {
                                chrome.runtime.sendMessage({
                                    type: 'REFRESH_SPEAKERS',
                                    payload: SPEAKERS,
                                })
                            } else {
                                setTimeout(
                                    () => refreshSpeaker(SPEAKERS.length - 1),
                                    PROVIDER.MIN_SPEAKER_DURATION + 500,
                                )
                            }
                        }
                        console.log('speaker changed to: ', speaker)
                    }
                } else {
                    // New logic for Meet and Teams
                    const activeSpeakers = speakers.filter((s) => s.isSpeaking)
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
                        // TODO : Remove it when it is done
                        chrome.runtime.sendMessage({
                            type: 'SEND_TO_SERVER',
                            payload: {
                                messageType: 'LOG_INFO',
                                data: { reason: 'gros test sa mere' },
                            },
                        })
                    }
                }

                // Update last speech timestamp
                if (speakers.some((s) => s.isSpeaking)) {
                    lastSpeechTimestamp = Date.now()
                }
            } catch (e) {
                console.error('an exception occurred in observeSpeaker', e)
                console.log('an exception occurred in observeSpeaker', e)
            }
        })
    })

    try {
        const speakers = R.filter(
            (u) => u.name !== BOT_NAME,
            PROVIDER.getSpeakerFromDocument(null, null, RECORDING_MODE),
        )

        const speaker = speakers[0]
        if (speaker) {
            SPEAKERS.push(speaker)
            lastSpeechTimestamp = Date.now()
            chrome.runtime.sendMessage({
                type: 'LOG',
                payload: `[ObserveSpeaker] initial speakers ${
                    SPEAKERS[SPEAKERS.length - 1].name
                }
                ${SPEAKERS[SPEAKERS.length - 1].timestamp}
                `,
            })
            chrome.runtime.sendMessage({
                type: 'REFRESH_SPEAKERS',
                payload: SPEAKERS,
            })
        } else {
            SPEAKERS.push({
                name: '-',
                timestamp: Date.now(),
                isSpeaking: false,
            })
            chrome.runtime.sendMessage({
                type: 'REFRESH_SPEAKERS',
                payload: SPEAKERS,
            })
            chrome.runtime.sendMessage({
                type: 'LOG',
                payload: `[ObserveSpeaker] no initial speakers ${
                    SPEAKERS[SPEAKERS.length - 1].name
                }
                ${SPEAKERS[SPEAKERS.length - 1].timestamp}
                `,
            })
        }
    } catch (e) {
        console.error('an exception occurred starting observeSpeaker')
    }

    try {
        await PROVIDER.removeInitialShityHtml(RECORDING_MODE)
        await PROVIDER.getSpeakerRootToObserve(mutationObserver, RECORDING_MODE)
    } catch (e) {
        console.error('an exception occurred starting observeSpeaker')
    }
}

async function checkInactivity() {
    while (true) {
        const speakers = PROVIDER.getSpeakerFromDocument(
            null,
            null,
            RECORDING_MODE,
        )
        console.log('checking inactivity', speakers.length, lastSpeechTimestamp)
        if (speakers.length === 0) {
            if (Date.now() - lastSpeechTimestamp > INACTIVITY_THRESHOLD) {
                console.error('[wordPosterWorker] Meuh y a que des bots!!!')
                chrome.runtime.sendMessage({
                    type: 'SEND_TO_SERVER',
                    payload: {
                        messageType: 'STOP_MEETING',
                        data: { reason: 'Only bot in meeting' },
                    },
                })
                if (inactivityCheckInterval) {
                    clearInterval(inactivityCheckInterval)
                }
                break
            }
        } else {
            lastSpeechTimestamp = Date.now()
        }
        await sleep(1000)
    }
}
