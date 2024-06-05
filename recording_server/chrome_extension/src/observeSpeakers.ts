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

const SPEAKERS: Speaker[] = []

let PROVIDER = {
    getSpeakerFromDocument: ZoomProvider.getSpeakerFromDocument,
    removeShityHtml: ZoomProvider.removeShityHtml,
    MIN_SPEAKER_DURATION: ZoomProvider.MIN_SPEAKER_DURATION,
    SPEAKER_LATENCY: ZoomProvider.SPEAKER_LATENCY,
    getSpeakerRootToObserve: ZoomProvider.getSpeakerRootToObserve,
    findAllAttendees: ZoomProvider.findAllAttendees,
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
        }
    } else if (MEETING_PROVIDER === 'Meet') {
        PROVIDER = {
            getSpeakerFromDocument: MeetProvider.getSpeakerFromDocument,
            removeShityHtml: MeetProvider.removeShityHtml,
            MIN_SPEAKER_DURATION: MeetProvider.MIN_SPEAKER_DURATION,
            SPEAKER_LATENCY: MeetProvider.SPEAKER_LATENCY,
            getSpeakerRootToObserve: MeetProvider.getSpeakerRootToObserve,
            findAllAttendees: MeetProvider.findAllAttendees,
        }
    } else {
        PROVIDER = {
            getSpeakerFromDocument: ZoomProvider.getSpeakerFromDocument,
            removeShityHtml: ZoomProvider.removeShityHtml,
            MIN_SPEAKER_DURATION: ZoomProvider.MIN_SPEAKER_DURATION,
            SPEAKER_LATENCY: ZoomProvider.SPEAKER_LATENCY,
            getSpeakerRootToObserve: ZoomProvider.getSpeakerRootToObserve,
            findAllAttendees: ZoomProvider.findAllAttendees,
        }
    }
}

async function removeShityHtmlLoop() {
    while (true) {
        PROVIDER.removeShityHtml()
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
    try {
        removeShityHtmlLoop()
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
                PROVIDER.removeShityHtml()
            }
            try {
                const speakers = PROVIDER.getSpeakerFromDocument(
                    SPEAKERS.length > 0
                        ? SPEAKERS[SPEAKERS.length - 1].name
                        : null,
                    mutation,
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
                    console.log('no speaker change')
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
            PROVIDER.getSpeakerFromDocument(null, null),
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
            // chrome.runtime.sendMessage({
            //     type: 'LOG',
            //     payload: 'NO INITIAL SPEAKER, forcing to empty speaker',
            // })
            // SPEAKERS.push({ timestamp: Date.now(), name: `-` })
            // chrome.runtime.sendMessage({
            //     type: 'REFRESH_SPEAKERS',
            //     payload: SPEAKERS,
            // })
        }

        await PROVIDER.getSpeakerRootToObserve(mutationObserver)
    } catch (e) {
        console.error('an exception occured startion observeSpeaker')
    }
}
