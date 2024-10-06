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
    LATENCY: number
    findAllAttendees: () => string[]
    removeInitialShityHtml: (arg0: RecordingMode) => void
    removeShityHtml: (arg0: RecordingMode) => void
    getSpeakerFromDocument: (arg0: RecordingMode, arg1: number) => SpeakerData[]
    getSpeakerRootToObserve: (
        arg0: RecordingMode,
    ) => Promise<[Node, MutationObserverInit] | undefined>
}

let PROVIDER: Provider | null = null
var CUR_SPEAKERS: Map<string, boolean> = new Map()

setMeetingProvider()
observeSpeakers()

function setMeetingProvider() {
    if (MEETING_PROVIDER === 'Teams') {
        PROVIDER = {
            LATENCY: TeamsProvider.SPEAKER_LATENCY,
            findAllAttendees: TeamsProvider.findAllAttendees,
            removeInitialShityHtml: TeamsProvider.removeInitialShityHtml,
            removeShityHtml: TeamsProvider.removeShityHtml,
            getSpeakerFromDocument: TeamsProvider.getSpeakerFromDocument,
            getSpeakerRootToObserve: TeamsProvider.getSpeakerRootToObserve,
        }
    } else if (MEETING_PROVIDER === 'Meet') {
        PROVIDER = {
            LATENCY: MeetProvider.SPEAKER_LATENCY,
            findAllAttendees: MeetProvider.findAllAttendees,
            removeInitialShityHtml: MeetProvider.removeInitialShityHtml,
            removeShityHtml: MeetProvider.removeShityHtml,
            getSpeakerFromDocument: MeetProvider.getSpeakerFromDocument,
            getSpeakerRootToObserve: MeetProvider.getSpeakerRootToObserve,
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
                    !attendee.toLowerCase().includes('notetaker'), // notetaker is for competiter bot's
                PROVIDER!.findAllAttendees(),
            )
            console.log('refresh participants loop :', allAttendees)
            chrome.runtime.sendMessage({
                type: 'REFRESH_ATTENDEES',
                payload: allAttendees,
            })
        } catch (e) {
            console.error('Catch on refresh attendees :', e)
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

// ___PERIODIC_SEQUENCE_FOR_EACH_MUTATIONS___
var MUTATION_OBSERVER = new MutationObserver(function (mutations) {
    const timestamp = Date.now() - PROVIDER!.LATENCY
    mutations.forEach(function (_mutation) {
        if (parameters.meetingProvider === 'Teams') {
            PROVIDER?.removeShityHtml(RECORDING_MODE)
        }
        try {
            const currentSpeakersList: SpeakerData[] =
                PROVIDER!.getSpeakerFromDocument(RECORDING_MODE, timestamp)

            let new_speakers = new Map(
                currentSpeakersList.map((elem) => [elem.name, elem.isSpeaking]),
            )
            function areMapsEqual<
                K,
                V,
            >(map1: Map<K, V>, map2: Map<K, V>): boolean {
                if (map1.size !== map2.size) {
                    return false
                }
                for (let [key, value] of map1) {
                    if (!map2.has(key) || map2.get(key) !== value) {
                        return false
                    }
                }
                return true
            }
            // Send data only when a speakers change state is detected
            if (!areMapsEqual(CUR_SPEAKERS, new_speakers)) {
                ApiService.sendMessageToRecordingServer(
                    'SPEAKERS',
                    currentSpeakersList,
                ).catch((e) => {
                    console.error('Catch on send currentSpeakersList :', e)
                })
                CUR_SPEAKERS = new_speakers
            }
        } catch (e) {
            console.error('Catch on MutationObserver :', e)
        }
    })
})

// Observe Speakers mutation
async function observeSpeakers() {
    if (MEETING_PROVIDER === 'Zoom') {
        console.info(
            'ZOOM observation speackers is not handled by the Extension!',
        )
        return
    } else {
        console.log('start observe speakers', RECORDING_MODE)
    }
    try {
        removeShityHtmlLoop(RECORDING_MODE)
        refreshAttendeesLoop()
    } catch (e) {
        console.log('Catch on Initial step into observeSpeaker failed :', e)
    }

    // ___INITIAL_SEQUENCE___
    try {
        const currentSpeakersList: SpeakerData[] = R.filter(
            (u: SpeakerData) => u.name !== BOT_NAME && u.isSpeaking == true,
            PROVIDER!.getSpeakerFromDocument(
                RECORDING_MODE,
                Date.now() - PROVIDER!.LATENCY,
            ),
        )

        if (currentSpeakersList.length > 0) {
            // Send initial active speakers if present
            ApiService.sendMessageToRecordingServer(
                'SPEAKERS',
                currentSpeakersList,
            ).catch((e) => {
                console.error('Catch on send initial speakers list :', e)
            })
        } else {
            // El Famoso speaker '-'
            ApiService.sendMessageToRecordingServer('SPEAKERS', [
                {
                    name: '-',
                    id: 0,
                    timestamp: Date.now() - PROVIDER!.LATENCY,
                    isSpeaking: true, // I am confused !
                },
            ] as SpeakerData[]).catch((e) => {
                console.error('Catch on send special speaker - :', e)
            })
        }
    } catch (e) {
        console.error('Catch on initial observe speaker sequence :', e)
    }

    try {
        await PROVIDER?.removeInitialShityHtml(RECORDING_MODE)
        let observe_parameters = (await PROVIDER?.getSpeakerRootToObserve(
            RECORDING_MODE,
        ))!
        MUTATION_OBSERVER.observe(observe_parameters[0], observe_parameters[1])
    } catch (e) {
        console.error('Catch on observe speaker init terminaison :', e)
    }
}
