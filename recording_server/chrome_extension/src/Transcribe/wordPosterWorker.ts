import { sleep } from '../utils'
import { api, RecognizerWord } from 'spoke_api_js'
import * as R from 'ramda'
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
                    return w.ts >= v.tcin && w.ts <= v.tcout
                }, session.video_informations)
                return v != null && v.complete_editor != null
            }, session.words)

            session.words = nonPushable
            console.log(
                '[wordPosterWorker] routine pushable length',
                pushable.length,
            )
            console.log(
                '[wordPosterWorker] routine nonpushable length',
                pushable.length,
            )
            const pushableClone = [...pushable]
            await pushWords(pushableClone)

            if (pushable.length > 0) {
                for (const v of session.video_informations) {
                    const video = v.complete_editor?.video
                    if (
                        video != null &&
                        video.transcription_completed === false &&
                        session.transcribed_until >= v.tcout
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

    while (!Transcriber.STOPPED) {
        await routine()
        await sleep(5_000)
        console.log('[wordPosterWorker] end while loop')
    }

    console.log('[wordPosterWorker] execute last routine')
    await routine()
}

async function pushWords(pushable: RecognizerWord[]) {
    for (const v of SESSION!.video_informations) {
        if (pushable.length === 0) {
            break
        }
        const [wordsWithin, wordNotWithin]: [
            RecognizerWord[],
            RecognizerWord[],
        ] = R.partition((w) => w.ts >= v.tcin && w.ts <= v.tcout, pushable)
        pushable = wordNotWithin
        if (wordsWithin.length > 0) {
            const transcript_id = v.complete_editor?.video.transcripts[0].id!
            const video_id = v.complete_editor?.video.id!

            const words = await api.postWord(
                wordsWithin,
                transcript_id,
                video_id,
            )
            for (const w of words) {
                v.words.push(w)
                SESSION!.transcribed_until = Math.max(
                    SESSION!.transcribed_until,
                    w.end_time,
                )
            }
        }
    }
}
