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

type Provider = {
    getSpeakerFromDocument: any
    removeShityHtml: any
    getSpeakerRootToObserve: any
    findAllAttendees: any
    removeInitialShityHtml: any
    MIN_SPEAKER_DURATION: Number
    SPEAKER_LATENCY: Number
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
    while (true) {
        try {
            const allAttendees = R.filter(
                (attendee: string) =>
                    attendee != BOT_NAME &&
                    !attendee.toLowerCase().includes('notetaker'),
                PROVIDER?.findAllAttendees(),
            )
            console.log(`refresh participants loop : ${allAttendees}`)
            chrome.runtime.sendMessage({
                type: 'REFRESH_ATTENDEES',
                payload: allAttendees,
            })
        } catch (e) {
            console.error(`Catch on refresh attendees : ${e}`)
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
        console.info(
            'ZOOM observation speackers is not handled by the Extension!',
        )
        return
    } else {
        console.log(`start observe speakers ${RECORDING_MODE}`)
    }
    try {
        removeShityHtmlLoop(RECORDING_MODE)
        refreshAttendeesLoop()
    } catch (e) {
        console.log(`Catch on Initial step into observeSpeaker failed : ${e}`)
    }

    // ___PERIODIC_SEQUENCE_FOR_EACH_MUTATIONS___
    var mutationObserver = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
            if (parameters.meetingProvider === 'Teams') {
                PROVIDER?.removeShityHtml(RECORDING_MODE)
            }
            try {
                // PHILOU : Je ne m'en sort pas ici. On ne devrait pas avoir a connaitre le speaker actuel,
                // c'est faux presque !!!
                // apparement c'est plus simple pour tems que pour meet
                // Ca ne compile pas ici puisque le tableau SPEAKERS n'a plus rien a faire ici.
                const currentSpeakersList = PROVIDER?.getSpeakerFromDocument(
                    SPEAKERS.length > 0
                        ? SPEAKERS[SPEAKERS.length - 1].name
                        : null,
                    mutation,
                    RECORDING_MODE,
                )
                if (currentSpeakersList.length > 0) {
                    ApiService.sendMessageToRecordingServer(
                        'SPEAKERS',
                        currentSpeakersList,
                    ).catch((e) => {
                        console.error(
                            `Catch on send currentSpeakersList : ${e}`,
                        )
                    })
                }
                // PHILOU : C'est une logique interessante, mais ca devrait etre ailleurs, comme sur la background par ex.
                // // New logic for Meet and Teams
                // const activeSpeakers = currentSpeakersList.filter(
                //     (s) => s.isSpeaking,
                // )
                // // si lazare parle,  si Philippe se met a parler en meme temps
                // // philippe prend forcement la precedence
                // const newActiveSpeakers = activeSpeakers.filter(
                //     (s) =>
                //         s.name !== BOT_NAME &&
                //         (SPEAKERS.length === 0 ||
                //             s.name !== SPEAKERS[SPEAKERS.length - 1].name),
                // )
                // // essayer de gerer MIN DURATION ICI ?
                // //  && Date.now() - s.timestamp >
                // //     PROVIDER.MIN_SPEAKER_DURATION)),

                // if (newActiveSpeakers.length > 0) {
                //     // TODO: not handling multiple speakers in the same time
                //     const newSpeaker = newActiveSpeakers[0]
                //     SPEAKERS.push(newSpeaker)
                //     console.log('speaker changed to: ', newSpeaker)
                //     chrome.runtime.sendMessage({
                //         type: 'REFRESH_SPEAKERS',
                //         payload: SPEAKERS,
                //     })
                // }
            } catch (e) {
                console.error(`Catch on MutationObserver : ${e}`)
            }
        })
    })

    // ___INITIAL_SEQUENCE___
    try {
        const currentSpeakersList: SpeakerData[] = R.filter(
            (u: SpeakerData) => u.name !== BOT_NAME && u.isSpeaking == true,
            PROVIDER?.getSpeakerFromDocument(null, null, RECORDING_MODE),
        )

        if (currentSpeakersList.length > 0) {
            // Send initial active speakers if present
            ApiService.sendMessageToRecordingServer(
                'SPEAKERS',
                currentSpeakersList,
            ).catch((e) => {
                console.error(`Catch on send initial speakers list : ${e}`)
            })
        } else {
            // El Famoso speaker '-'
            ApiService.sendMessageToRecordingServer('SPEAKERS', [
                {
                    name: '-',
                    id: 0,
                    timestamp: Date.now(),
                    isSpeaking: true, // I am confused !
                },
            ] as SpeakerData[]).catch((e) => {
                console.error(`Catch on send special speaker - : ${e}`)
            })
        }
    } catch (e) {
        console.error(`Catch on initial observe speaker sequence : ${e}`)
    }

    try {
        await PROVIDER?.removeInitialShityHtml(RECORDING_MODE)
        await PROVIDER?.getSpeakerRootToObserve(
            mutationObserver,
            RECORDING_MODE,
        )
    } catch (e) {
        console.error(`Catch on observe speaker init terminaison : ${e}`)
    }
}
