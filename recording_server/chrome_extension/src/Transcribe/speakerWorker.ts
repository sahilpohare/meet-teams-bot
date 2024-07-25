import { SESSION } from '../record'
import { SPEAKERS } from '../background'
import { Transcriber } from './Transcriber'
import { sleep } from '../api'
import { uploadEditorsTask } from '../uploadEditors'

export async function speakerWorker() {
    async function routine() {
        const session = SESSION
        if (!session) return

        try {
            const now = new Date().getTime()
            const lastSpeaker = SPEAKERS[SPEAKERS.length - 1]
            if (now - lastSpeaker.timestamp > 60_000) {
                console.log(
                    'wordPosterWorker: no speaker in the last minute, forcing same speaker',
                )
                SPEAKERS.push({
                    name: lastSpeaker.name,
                    id: 0,
                    timestamp: now,
                    isSpeaking: true,
                })
                await uploadEditorsTask(SPEAKERS)
            }
        } catch (e) {
            console.error('[wordPosterWorker]', e)
        }
    }

    while (Transcriber.TRANSCRIBER?.is_running()) {
        await routine()
        await sleep(5_000)
    }
}
