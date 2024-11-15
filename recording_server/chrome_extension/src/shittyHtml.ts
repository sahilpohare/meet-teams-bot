import { RecordingMode } from './api'

import * as MeetProvider from './shittyHtml/meet'
import * as TeamsProvider from './shittyHtml/teams'

declare var MEETING_PROVIDER: string
declare var RECORDING_MODE: RecordingMode

type Provider = {
    removeInitialShityHtml: (arg0: RecordingMode) => void
    removeShityHtml: (arg0: RecordingMode) => void
}

let PROVIDER: Provider | null = null

setMeetingProvider()
removeShittyHtml()

function setMeetingProvider() {
    if (MEETING_PROVIDER === 'Teams') {
        PROVIDER = {
            removeInitialShityHtml: TeamsProvider.removeInitialShityHtml,
            removeShityHtml: TeamsProvider.removeShityHtml,
        }
    } else if (MEETING_PROVIDER === 'Meet') {
        PROVIDER = {
            removeInitialShityHtml: MeetProvider.removeInitialShityHtml,
            removeShityHtml: MeetProvider.removeShityHtml,
        }
    } else {
        PROVIDER = null
    }
}

async function removeShittyHtml() {
    if (MEETING_PROVIDER === 'Zoom') {
        console.info('Remove shitty of zoom is not handled by the Extension!')
        return
    }
    PROVIDER?.removeInitialShityHtml(RECORDING_MODE)
    PROVIDER?.removeShityHtml(RECORDING_MODE)
    setInterval((mode) => PROVIDER?.removeShityHtml(mode), 1000, RECORDING_MODE)

    MUTATION_OBSERVER.observe(getDocumentRoot())
}

// ___PERIODIC_SEQUENCE_FOR_EACH_MUTATIONS___
var MUTATION_OBSERVER = new MutationObserver(function (mutations) {
    mutations.forEach(function (_mutation) {
        if (MEETING_PROVIDER === 'Teams') {
            PROVIDER?.removeShityHtml(RECORDING_MODE)
        }
    })
})

function getDocumentRoot(): Document {
    for (let iframe of document.querySelectorAll('iframe')) {
        try {
            const doc = iframe.contentDocument || iframe.contentWindow?.document
            if (doc) {
                console.log('[Teams] Document root found in iframe')
                return doc
            }
        } catch (e) {
            console.warn('[Teams] Error accessing iframe content', e)
        }
    }
    console.log('[Teams] Using main document as root')
    return document
}
