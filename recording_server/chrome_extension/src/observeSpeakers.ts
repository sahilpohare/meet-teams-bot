import * as R from 'ramda'
type Speaker = {
    name: string
    timestamp: number
}

declare var BOT_NAME: string
declare var MEETING_PROVIDER: string

const SPEAKERS: Speaker[] = []
import * as ZoomProvider from './observeSpeakers/zoom'
import * as TeamsProvider from './observeSpeakers/teams'
import * as MeetProvider from './observeSpeakers/meet'
import { sleep } from './utils'
import { parameters } from './state'

let PROVIDER = {
    getSpeakerFromDocument: ZoomProvider.getSpeakerFromDocument,
    removeShityHtml: ZoomProvider.removeShityHtml,
    MIN_SPEAKER_DURATION: ZoomProvider.MIN_SPEAKER_DURATION,
    SPEAKER_LATENCY: ZoomProvider.SPEAKER_LATENCY,
    getSpeakerRootToObserve: MeetProvider.getSpeakerRootToObserve,
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
        }
    } else if (MEETING_PROVIDER === 'Meet') {
        PROVIDER = {
            getSpeakerFromDocument: MeetProvider.getSpeakerFromDocument,
            removeShityHtml: MeetProvider.removeShityHtml,
            MIN_SPEAKER_DURATION: MeetProvider.MIN_SPEAKER_DURATION,
            SPEAKER_LATENCY: MeetProvider.SPEAKER_LATENCY,
            getSpeakerRootToObserve: MeetProvider.getSpeakerRootToObserve,
        }
    } else {
        PROVIDER = {
            getSpeakerFromDocument: ZoomProvider.getSpeakerFromDocument,
            removeShityHtml: ZoomProvider.removeShityHtml,
            MIN_SPEAKER_DURATION: ZoomProvider.MIN_SPEAKER_DURATION,
            SPEAKER_LATENCY: ZoomProvider.SPEAKER_LATENCY,
            getSpeakerRootToObserve: ZoomProvider.getSpeakerRootToObserve,
        }
    }
}

async function removeShityHtmlLoop() {
    while (true) {
        console.log('remove shity html loop')
        PROVIDER.removeShityHtml()
        await sleep(1000)
    }
}
async function observeSpeakers() {
    // console.log('repush')
    try {
        removeShityHtmlLoop()
        // PROVIDER.removeShityHtml()
    } catch (e) {
        console.log('an exception occured in remove shity html', e)
    }
    console.log('after remove shity html')
    function refreshSpeaker(index: number) {
        console.log('timeout refresh speaker')
        if (index < SPEAKERS.length) {
            let lastSpeaker = SPEAKERS[index]
            const now = Date.now() - PROVIDER.SPEAKER_LATENCY
            const speakerDuration = now - lastSpeaker.timestamp
            if (speakerDuration > 2000) {
                chrome.runtime.sendMessage({
                    type: 'REFRESH_SPEAKERS',
                    payload: SPEAKERS.slice(0, index + 1),
                })
            } else {
                console.log('speaker changed in the last 2 secs')
            }
        }
    }

    var mutationObserver = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
            if (parameters.meeting_provider === 'Teams') {
                PROVIDER.removeShityHtml()
            }
            // try {
            //     PROVIDER.removeShityHtml()
            // } catch (e) {
            //     console.log('an exception occured in remove shity html', e)
            // }
            try {
                const speakers = PROVIDER.getSpeakerFromDocument(mutation)

                // const speakerName = getSpakerNameFromMutation(mutation)
                // console.log(speakerName)
                if (speakers.length > 0) {
                    const previousSpeaker = SPEAKERS[SPEAKERS.length - 1]
                    const speakersFiltered = R.filter(
                        (u) => u !== BOT_NAME && u !== previousSpeaker.name,
                        speakers,
                    )
                    const speakerName = speakersFiltered[0]
                    const newSpeaker = {
                        name: speakerName,
                        timestamp: Date.now() - PROVIDER.SPEAKER_LATENCY,
                    }

                    if (speakerName) {
                        console.log({ speakerName })
                        const speakerDuration =
                            newSpeaker.timestamp - previousSpeaker.timestamp
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
                            if (
                                MEETING_PROVIDER === 'Zoom' ||
                                MEETING_PROVIDER === 'Meet'
                            ) {
                                chrome.runtime.sendMessage({
                                    type: 'REFRESH_SPEAKERS',
                                    payload: SPEAKERS,
                                })

                                SPEAKERS.push(newSpeaker)
                                setTimeout(
                                    () => refreshSpeaker(SPEAKERS.length - 1),
                                    PROVIDER.MIN_SPEAKER_DURATION + 500,
                                )
                            } else {
                                SPEAKERS.push(newSpeaker)
                                chrome.runtime.sendMessage({
                                    type: 'REFRESH_SPEAKERS',
                                    payload: SPEAKERS,
                                })
                            }
                            console.log('speaker changed to: ', speakerName)
                        }
                    } else {
                        console.log('no speaker change')
                    }
                } else {
                    // console.log('bad ', { mutation })
                }
            } catch (e) {
                console.error('an exception occured in observeSpeaker', e)
                console.log('an exception occured in observeSpeaker', e)
            }
        })
    })
    try {
        // speaker-bar-container__video-frame speaker-bar-container__video-frame--active
        // Starts listening for changes in the root HTML element of the page.
        const speakers = R.filter(
            (u) => u !== BOT_NAME,
            PROVIDER.getSpeakerFromDocument(null),
        )

        const speakerName = speakers[0]
        if (speakerName) {
            SPEAKERS.push({ timestamp: Date.now(), name: speakerName })
            console.log(
                '[ObserveSpeaker] inital speakers',
                SPEAKERS[SPEAKERS.length - 1],
            )
            chrome.runtime.sendMessage({
                type: 'REFRESH_SPEAKERS',
                payload: SPEAKERS,
            })
        } else {
            console.error('NO INITIAL SPEAKER')
            console.log('forcing first speaker')
            SPEAKERS.push({ timestamp: Date.now(), name: `` })
            chrome.runtime.sendMessage({
                type: 'REFRESH_SPEAKERS',
                payload: SPEAKERS,
            })
        }

        await PROVIDER.getSpeakerRootToObserve(mutationObserver)

        // else {
        //     console.error('no inital speaker', initialSpeaker)
        //     SPEAKERS.push({ timestamp: Date.now(), name: `speaker 0` })
        //     console.log('[ObserveSpeaker]', chrome.runtime)
        //     chrome.runtime.sendMessage({ type: "REFRESH_SPEAKERS", payload: SPEAKERS });
        // }
    } catch (e) {
        console.error('an exception occured startion observeSpeaker')
    }
}

// function getAllClasses() {
//     var allClasses: string[] = [];

//     var allElements = document.querySelectorAll('*');

//     for (var i = 0; i < allElements.length; i++) {
//         var classes = allElements[i].className.toString().split(/\s+/);
//         for (var j = 0; j < classes.length; j++) {
//             var cls = classes[j];
//             if (cls && allClasses.indexOf(cls) === -1)
//                 allClasses.push(cls);
//         }
//     }
//     return allClasses
// }
