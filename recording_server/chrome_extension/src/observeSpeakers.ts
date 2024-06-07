import * as R from 'ramda'
import * as MeetProvider from './observeSpeakers/meet'
import * as TeamsProvider from './observeSpeakers/teams'
import * as ZoomProvider from './observeSpeakers/zoom'
import { parameters } from './state'
import { sleep } from './utils'
export type Speaker = {
    name: string
    timestamp: number
}

declare var BOT_NAME: string
declare var MEETING_PROVIDER: string
declare var RECORDING_MODE: RecordingMode
export type RecordingMode = 'speaker_view' | 'galery_view' | 'audio_only'

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
            removeInitialShityHtml: ZoomProvider.removeInitialShityHtml,
        }
    } else if (MEETING_PROVIDER === 'Meet') {
        PROVIDER = {
            getSpeakerFromDocument: MeetProvider.getSpeakerFromDocument,
            removeShityHtml: MeetProvider.removeShityHtml,
            MIN_SPEAKER_DURATION: MeetProvider.MIN_SPEAKER_DURATION,
            SPEAKER_LATENCY: MeetProvider.SPEAKER_LATENCY,
            getSpeakerRootToObserve: MeetProvider.getSpeakerRootToObserve,
            findAllAttendees: MeetProvider.findAllAttendees,
            removeInitialShityHtml: ZoomProvider.removeInitialShityHtml,
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
            console.error('an exception occured in refresh attendees', e)
        }
        await sleep(10000)
    }
}
async function observeSpeakers() {
    console.log('start observe speakers', RECORDING_MODE)
    try {
        removeShityHtmlLoop(RECORDING_MODE)
        refreshAttendeesLoop()
    } catch (e) {
        console.log('an exception occured in remove shity html', e)
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

                const previousSpeaker =
                    SPEAKERS.length > 0
                        ? SPEAKERS[SPEAKERS.length - 1]
                        : undefined
                const speakersFiltered = R.filter(
                    (u) =>
                        u.name !== BOT_NAME && u.name !== previousSpeaker?.name,
                    speakers,
                )
                const speaker = speakersFiltered[0]

                if (speaker) {
                    const newSpeaker = {
                        name: speaker.name,
                        timestamp: speaker.timestamp - PROVIDER.SPEAKER_LATENCY,
                    }
                    const speakerDuration =
                        newSpeaker.timestamp - (previousSpeaker?.timestamp ?? 0)
                    if (
                        MEETING_PROVIDER === 'Zoom' &&
                        speakerDuration < PROVIDER.MIN_SPEAKER_DURATION
                    ) {
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
                        if (MEETING_PROVIDER === 'Zoom') {
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
                        } else {
                            SPEAKERS.push(newSpeaker)
                            chrome.runtime.sendMessage({
                                type: 'REFRESH_SPEAKERS',
                                payload: SPEAKERS,
                            })
                        }
                        console.log('speaker changed to: ', speaker)
                    }
                } else {
                    console.log('no speaker change', speaker)
                }
            } catch (e) {
                console.error('an exception occured in observeSpeaker', e)
                console.log('an exception occured in observeSpeaker', e)
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

            chrome.runtime.sendMessage({
                type: 'LOG',
                payload: `[ObserveSpeaker] inital speakers ${
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
            SPEAKERS.push({ name: '-', timestamp: Date.now() })
            chrome.runtime.sendMessage({
                type: 'REFRESH_SPEAKERS',
                payload: SPEAKERS,
            })
            chrome.runtime.sendMessage({
                type: 'LOG',
                payload: `[ObserveSpeaker] no inital speakers ${
                    SPEAKERS[SPEAKERS.length - 1].name
                }
                ${SPEAKERS[SPEAKERS.length - 1].timestamp}
                `,
            })
        }
    } catch (e) {
        console.error('an exception occured startion observeSpeaker')
    }
    try {
        await PROVIDER.removeInitialShityHtml(RECORDING_MODE)
        await PROVIDER.getSpeakerRootToObserve(mutationObserver, RECORDING_MODE)
    } catch (e) {
        console.error('an exception occured starting observeSpeaker')
    }
}
