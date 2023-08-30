import { Transcriber } from './streaming'
import * as R from 'ramda'
import { parameters } from '../background'
import { START_RECORD_TIMESTAMP, SESSION } from '../record'
import { sleep } from '../utils'
import {
    api,
    SummaryParam,
    WordHighlight,
    WordSummary,
    Label,
} from 'spoke_api_js'

const MAX_TOKEN = 3_450
// in milis seconds
const MIN_TO_HIGHLIGHT = 180_000

let EMPTY_LABEL: Label | null = null

export async function highlightWorker(): Promise<void> {
    let i = 0

    while (!Transcriber.STOPPED) {
        if (SESSION) {
            if (i % 100 === 0) {
                try {
                    await calcHighlights(false)
                } catch (e) {
                    console.log(e, 'calcHighlights() failed')
                }
            }
            i++
        }

        await sleep(5_000)
    }
}

export async function calcHighlights(isFinal: boolean): Promise<boolean> {
    if (SESSION) {
        const project_id = SESSION.project.id
        const asset_id = SESSION.asset.id
        const collect = collectSentenceToHighlight(isFinal)
        console.log('[calcHighlights] collect: ', collect)
        if (collect != null) {
            const [words, startTime, endTime] = collect
            const search = api.getHighlightMarkers(
                parameters.markers,
                START_RECORD_TIMESTAMP,
                [startTime, endTime],
            )
            console.log('[calcHighlights] search', search)
            if (search.length > 0) {
                try {
                    const clips = await api.highlights(words, search)
                    // console.log('[calcHighlights] clips:', clips)
                    for (const clip of clips) {
                        console.log('[calcHighlights] posting clip: ', clips)
                        try {
                            let summaryClipitem = ''
                            let startTime: number | null = clip.start_time
                            while (startTime != null) {
                                const collect =
                                    await collectSentenceToSummarizeClip(
                                        startTime,
                                        clip.end_time,
                                    )
                                console.log(
                                    '[calcHighlights] ',
                                    'collect: ',
                                    startTime,
                                    clip.end_time,
                                    collect,
                                )
                                if (
                                    collect != null &&
                                    collect.summaryParam.sentences.length > 0
                                ) {
                                    const summaryPart = await api.summarize(
                                        collect.summaryParam,
                                    )
                                    console.log(
                                        '[calcHighlights] ',
                                        'summaryPart: ',
                                        summaryPart,
                                    )
                                    startTime = collect.newEndTime
                                    summaryClipitem += summaryPart
                                } else {
                                    break
                                }
                            }
                            if (clip.label_id == null) {
                                if (EMPTY_LABEL == null) {
                                    EMPTY_LABEL = await api.postLabel({
                                        name: '',
                                        color: '',
                                    })
                                }
                                clip.label_id = EMPTY_LABEL.id
                            }
                            const clipitem = await api.postClipitem(
                                {
                                    notes: clip.notes,
                                    in_time: clip.start_time,
                                    out_time: clip.end_time,
                                    label_ids:
                                        clip.label_id !== null
                                            ? [clip.label_id]
                                            : [],
                                    summary: summaryClipitem,
                                },
                                project_id,
                                asset_id,
                            )
                            console.log('[calcHighlights] ', { clipitem })
                        } catch (e) {
                            console.error(
                                '[calcHighlights] post clipitem failed',
                            )
                        }
                    }
                    return true
                } catch (e) {
                    console.error('[calcHighlights]', e)
                }
            }
        }
    }
    return false
}

function collectSentenceToHighlight(
    isFinal: boolean,
): [WordHighlight[], number, number] | undefined {
    let res: WordHighlight[] = []
    let startTime = -1
    let endTime = -1

    if (
        SESSION &&
        SESSION.next_editor_index_to_highlight <
            SESSION.video_informations.length
    ) {
        const video_infos = SESSION.video_informations
        let next_index_to_highlight = SESSION.next_editor_index_to_highlight
        for (
            let i = SESSION.next_editor_index_to_highlight;
            i < video_infos.length;
            i++
        ) {
            const video_info = video_infos[i]
            console.log(
                '[collectSentenceToHighlight]',
                SESSION.next_editor_index_to_highlight,
                i,
                SESSION.transcribed_until,
                video_info.tcout,
            )
            if (startTime === -1) {
                startTime = video_info.cutStart
            }

            if (!(SESSION.transcribed_until >= video_info.tcout || isFinal)) {
                break
            }
            endTime = video_info.cutEnd
            res = res.concat(video_info.words as WordHighlight[])
            next_index_to_highlight = i + 1
        }
        // console.log('[collectSentenceToHighlight]', res.length, endTime, endTime - startTime, isFinal)
        if (
            res.length !== 0 &&
            endTime !== -1 &&
            (endTime - startTime > MIN_TO_HIGHLIGHT || isFinal)
        ) {
            SESSION.next_editor_index_to_highlight = next_index_to_highlight
            return [res, startTime, endTime]
        }
    }
    return undefined
}

async function collectSentenceToSummarizeClip(
    inTime: number,
    endTime: number,
): Promise<
    { summaryParam: SummaryParam; newEndTime: number | null } | undefined
> {
    const res: SummaryParam & { fullSentence: string } = {
        sentences: [],
        fullSentence: '',
        max_token: 100,
        lang: parameters.language,
    }
    let newEndTime = null

    if (SESSION) {
        const video_infos = SESSION.video_informations
        for (let i = 0; i < video_infos.length; i++) {
            const video_info = video_infos[i]
            const video = video_info.complete_editor?.video
            if (
                video &&
                video.audio_offset <= endTime &&
                video?.audio_offset + video?.duration >= inTime
            ) {
                const words = video_info.words.filter(
                    (w) => w.start_time >= inTime && w.end_time <= endTime,
                )
                const newFullSentence =
                    res.fullSentence +
                    '\n' +
                    video_info.speaker_name +
                    ':' +
                    words.map((w) => w.text).join(' ')
                if (words.length > 0) {
                    res.sentences.push({
                        speaker: video_info.speaker_name,
                        words: words as WordSummary[],
                        // SESSION?.video_informations[
                        // } else {
                    })
                    const lastWord = R.last(words)
                    newEndTime = lastWord?.end_time
                    res.fullSentence = newFullSentence
                }
            }
        }
        return { summaryParam: res, newEndTime: newEndTime }
    }
    return undefined
}
