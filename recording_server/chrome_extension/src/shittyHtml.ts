import { RecordingMode } from './api'

import * as MeetProvider from './shittyHtml/meet'
import * as TeamsProvider from './shittyHtml/teams'

declare var MEETING_PROVIDER: string
declare var RECORDING_MODE: RecordingMode

type Provider = {
    removeInitialShityHtml: (arg0: RecordingMode) => Promise<void>
    removeShityHtml: (arg0: RecordingMode) => void
}

let PROVIDER: Provider | null = null

// Initialiser le provider
if (MEETING_PROVIDER === 'Teams') {
    PROVIDER = TeamsProvider
} else if (MEETING_PROVIDER === 'Meet') {
    PROVIDER = MeetProvider
}

// S'assurer que le provider est initialisé avant d'utiliser les fonctions
if (PROVIDER) {
    // Initialisation
    PROVIDER.removeInitialShityHtml(RECORDING_MODE)
        .catch(e => console.warn('Error in initial HTML cleanup:', e));

    // Observer les changements
    const observer = new MutationObserver(() => {
        if (PROVIDER) {
            PROVIDER.removeShityHtml(RECORDING_MODE);
        }
    });

    // Observer le document entier pour les changements
    if (document.documentElement) {  // Vérifier que documentElement existe
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    } else {
        console.warn('Document root element not found');
    }
} else {
    console.warn('No valid provider found for:', MEETING_PROVIDER);
}
