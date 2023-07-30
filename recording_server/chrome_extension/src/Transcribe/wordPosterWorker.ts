import { sleep } from '../utils'
import {
    api,
    RevWord,
} from 'spoke_api_js'
import * as R from 'ramda'
import { SESSION } from '../record'
import { STREAMING_TRANSCRIBE, STOPED } from './streaming'


export async function wordPosterWorker(workerVersion: number) {
    async function routine() {
        const spokeSession = SESSION
        if (spokeSession) {
            // console.log('[wordPosterWorker]', 'start: ', spokeSession.words)
            try {
                if (spokeSession != null) {
                    const [pushable, nonPushable]: [RevWord[], RevWord[]] =
                        R.partition((w: RevWord) => {
                            const v = R.find((v) => {
                                return w.ts >= v.tcin && w.ts <= v.tcout
                            }, spokeSession.video_informations)
                            return v != null && v.complete_editor != null
                        }, spokeSession.words)
                    // console.log('[wordPosterWorker] pushable, non pushable', pushable, nonPushable)
                    spokeSession.words = nonPushable
                    const pushableClone = [...pushable]
                    await pushWords(pushableClone)
                    if (pushable.length > 0) {
                        for (const v of spokeSession.video_informations) {
                            const video = v.complete_editor?.video
                            if (
                                video != null &&
                                video.transcription_completed === false &&
                                spokeSession.transcribed_until >= v.tcout
                            ) {
                                await api.patchVideo({
                                    id: video.id,
                                    transcription_completed: true,
                                })
                                video.transcription_completed = true
                            }
                        }
                    }
                }
            } catch (e) {
                console.error('[wordPosterWorker]', e)
            }
        }
    }
    let i = 0
    while (!STOPED) {
        if (
            STREAMING_TRANSCRIBE &&
            workerVersion !== STREAMING_TRANSCRIBE.workerVersion
        ) {
            console.log('returning from worker wordPoster')
            return
        }
        await routine()
        await sleep(5000)
        i++
    }
    await routine()
}

async function pushWords(pushable: RevWord[]) {
    for (const v of SESSION!.video_informations) {
        if (pushable.length === 0) {
            break
        }
        const [wordsWithin, wordNotWithin]: [RevWord[], RevWord[]] =
            R.partition((w) => w.ts >= v.tcin && w.ts <= v.tcout, pushable)
        pushable = wordNotWithin
        if (wordsWithin.length > 0) {
            const transcript_id = v.complete_editor?.video.transcripts[0].id!
            const video_id = v.complete_editor?.video.id!

            // console.log({ wordsWithin })
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
