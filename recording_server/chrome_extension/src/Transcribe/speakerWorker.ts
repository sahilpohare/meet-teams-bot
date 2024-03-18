import { SPEAKERS } from '../background'
import { SESSION } from '../record'
import { uploadEditorsTask } from '../uploadEditors'
import { sleep } from '../utils'
import { Transcriber } from './Transcriber'

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
                SPEAKERS.push({ name: lastSpeaker.name, timestamp: now })
                await uploadEditorsTask(SPEAKERS)
            }
        } catch (e) {
            console.error('[wordPosterWorker]', e)
        }
    }

    while (!Transcriber.TRANSCRIBER?.stopped) {
        await routine()
        await sleep(5_000)
    }

    console.log('[speaker worker] execute last routine')
}
