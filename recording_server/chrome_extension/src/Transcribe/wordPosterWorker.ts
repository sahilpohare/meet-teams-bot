import * as R from 'ramda'
import { api, RecognizerWord, sleep } from '../api'
import { SESSION } from '../record'
import { Transcriber } from './Transcriber'

export async function wordPosterWorker() {
    async function routine() {
        const session = SESSION
        if (!session) return

        try {
            const [pushable, nonPushable]: [
                RecognizerWord[],
                RecognizerWord[],
            ] = R.partition((w: RecognizerWord) => {
                const v = R.find((v) => {
                    return w.ts >= v.start_time && w.ts <= v.end_time
                }, session.transcripts)
                return v != null
            }, session.words)

            session.words = nonPushable
            const pushableClone = [...pushable]
            await pushWords(pushableClone)
        } catch (e) {
            console.error('[wordPosterWorker]', e)
        }
    }

    while (Transcriber.TRANSCRIBER?.is_running()) {
        await routine()
        await sleep(5_000)
        console.log('[wordPosterWorker] end while loop')
    }

    console.log('[wordPosterWorker] execute last routine')
    await routine()
}

async function pushWords(pushable: RecognizerWord[]) {
    for (const t of SESSION!.transcripts) {
        if (pushable.length === 0) {
            break
        }
        const [wordsWithin, wordNotWithin]: [
            RecognizerWord[],
            RecognizerWord[],
        ] = R.partition(
            (w) => w.ts >= t.start_time && w.ts <= t.end_time,
            pushable,
        )
        pushable = wordNotWithin
        if (wordsWithin.length > 0) {
            const transcript_id = t.id

            const wordFiltered = wordsWithin.filter((w) => w != null)
            const words = await api.postWords(wordFiltered, transcript_id)
            for (const w of words) {
                t.words.push(w)
                SESSION!.transcribedUntil = Math.max(
                    SESSION!.transcribedUntil,
                    w.end_time,
                )
            }
        }
    }
}
