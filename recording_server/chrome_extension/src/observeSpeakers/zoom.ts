//TODO: interpreter les erreurs de zoom pour les renvoyer au recording_server
//TODO: passer le message du bot en parametre =>done
import { RecordingMode, SpeakerData } from '../observeSpeakers'

//TODO: interpreter les erreurs de zoom pour les renvoyer au recording_server
//TODO: passer le message du bot en parametre

// TODO: question pour Micka:
// Comment je communique avec zoom? Axios dans zoom?
// Est ce que je dois utiliser l'extension?
// setMeetingProvider remonte dans le server?
// est ce qu'on veut pouvoir piloter toutes les fonctions depuis recording_server?
//TODO: injecter de la video? => ca ca a l'aire de fonctionner
//TODO: injecter du son?

export const MIN_SPEAKER_DURATION = 1000
export const SPEAKER_LATENCY = 500

export async function getSpeakerRootToObserve(
    mutationObserver: MutationObserver,
    recordingMode: RecordingMode,
): Promise<void> {
    const root = document.querySelector('body')!
    mutationObserver.observe(root, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
        attributeOldValue: true,
        characterDataOldValue: true,
    })
}

//class="gallery-video-container__video-frame gallery-video-container__video-frame--active react-draggable"
export function getSpeakerFromDocument(
    currentSpeaker: string | null,
    mutation: MutationRecord | null,
    recordingMode: RecordingMode,
): SpeakerData[] {
    return []
}

export function findAllAttendees(): string[] {
    return []
}
