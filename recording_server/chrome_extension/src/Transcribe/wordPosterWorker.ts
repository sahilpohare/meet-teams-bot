import * as R from 'ramda'
import { api, RecognizerWord } from 'spoke_api_js'
import { SESSION } from '../record'
import { sleep } from '../utils'
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
                    return (
                        w.ts >= v.video.audio_offset &&
                        w.ts <= v.video.audio_offset + v.video.duration
                    )
                }, session.completeEditors)
                return v != null
            }, session.words)

            session.words = nonPushable
            const pushableClone = [...pushable]
            await pushWords(pushableClone)

            if (pushable.length > 0) {
                for (const v of session.completeEditors) {
                    const video = v?.video
                    if (
                        video != null &&
                        video.transcription_completed === false &&
                        session.transcribedUntil >=
                            v.video.audio_offset + v.video.duration
                    ) {
                        await api.patchVideo({
                            id: video.id,
                            transcription_completed: true,
                        })
                        video.transcription_completed = true
                    }
                }
            }
        } catch (e) {
            console.error('[wordPosterWorker]', e)
        }
    }

    while (!Transcriber.TRANSCRIBER?.stopped) {
        await routine()
        await sleep(5_000)
        console.log('[wordPosterWorker] end while loop')
    }

    console.log('[wordPosterWorker] execute last routine')
    await routine()
}

async function pushWords(pushable: RecognizerWord[]) {
    for (const v of SESSION!.completeEditors) {
        if (pushable.length === 0) {
            break
        }
        const [wordsWithin, wordNotWithin]: [
            RecognizerWord[],
            RecognizerWord[],
        ] = R.partition(
            (w) =>
                w.ts >= v.video.audio_offset &&
                w.ts <= v.video.audio_offset + v.video.duration,
            pushable,
        )
        pushable = wordNotWithin
        if (wordsWithin.length > 0) {
            const transcript_id = v.video.transcripts[0].id!
            const video_id = v.video.id!

            const words = await api.postWord(
                wordsWithin,
                transcript_id,
                video_id,
            )
            for (const w of words) {
                v.video.transcripts[0].words.push(w)
                SESSION!.transcribedUntil = Math.max(
                    SESSION!.transcribedUntil,
                    w.end_time,
                )
            }
        }
    }
}
