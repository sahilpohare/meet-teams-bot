import { Transcriber } from './Transcriber'
import * as R from 'ramda'
import { parameters } from '../background'
import { SESSION } from '../record'
import { sleep } from '../utils'
import {
    api,
    SummaryParam,
    LABEL_COLORS,
    Agenda,
    AutoHighlightResponse,
    Sentence,
    Label,
} from 'spoke_api_js'

const MIN_TOKEN_GPT4 = 1500
const CONTEXT: AutoHighlightResponse = { clips: [] }

export async function summarizeWorker(): Promise<void> {
    let i = 1

    while (!Transcriber.TRANSCRIBER?.stopped) {
        if (SESSION) {
            if (i % 10 === 0) {
                try {
                    await trySummarizeNext(false)
                } catch (e) {
                    console.log(e, 'summarize failed')
                }
            }
            i++
        }

        await sleep(3_000)
    }
}

export async function trySummarizeNext(isFinal: boolean): Promise<boolean> {
    if (SESSION) {
        const labels = parameters.agenda ? extractLabels(parameters.agenda) : []
        const collect = await collectSentenceToAutoHighlight(isFinal, labels)

        if (collect != null && collect.length > 0) {
            if (parameters.agenda) {
                const agenda = await api.getAgendaWithId(parameters.agenda.id)
                await autoHighlight(agenda, collect)
            } else {
                parameters.agenda = await detectTemplate(collect)

                try {
                    await api.patchProject({
                        id: SESSION.project.id,
                        template: parameters.agenda.json,
                        original_agenda_id: parameters.agenda.id,
                    })
                } catch (e) {
                    console.error('failed to patch project')
                }
                await api.notifyApp(parameters.user_token, {
                    message: 'AgendaDetected',
                    user_id: parameters.user_id,
                    payload: { agenda_id: parameters.agenda.id },
                })

                await autoHighlight(parameters.agenda, collect)
            }
            try {
                await api.notifyApp(parameters.user_token, {
                    message: 'RefreshProject',
                    user_id: parameters.user_id,
                    payload: { project_id: SESSION.project.id },
                })
            } catch (e) {
                console.error('notify failed')
            }

            return true
        } else {
            return false
        }
    }

    return false
}

async function collectSentenceToAutoHighlight(
    isFinal: boolean,
    labels: string[],
): Promise<Sentence[] | undefined> {
    const res: SummaryParam = {
        sentences: [],
        lang: parameters.language,
    }
    let withNextIsMaxToken = false

    if (
        SESSION &&
        SESSION.next_editor_index_to_summarise <
            SESSION.video_informations.length
    ) {
        const video_infos = SESSION.video_informations
        let next_index_to_summarise = SESSION.next_editor_index_to_summarise
        for (
            let i = SESSION.next_editor_index_to_summarise;
            i < video_infos.length;
            i++
        ) {
            const video_info = video_infos[i]
            console.log('[collectSentenceToSummarize]', {
                next_editor_index_to_summarize:
                    SESSION.next_editor_index_to_summarise,
                i: i,
                transcribed_until: SESSION.transcribed_until,
                tcout: video_info.tcout,
                sentences: res.sentences,
            })
            if (
                !(SESSION.transcribed_until >= video_info.tcout || isFinal) ||
                (await autoHighlightCountToken(res.sentences, labels)) >
                    MIN_TOKEN_GPT4
            ) {
                break
            }
            if (video_info.words.length > 0) {
                res.sentences.push({
                    speaker: video_info.speaker_name,
                    words: video_info.words.map((w) => ({ text: w.text! })),
                    start_timestamp: video_info.words[0].start_time,
                    end_timestamp:
                        video_info.words[video_info.words.length - 1].end_time,
                })
            }
            next_index_to_summarise = i + 1
        }
        if (
            (await autoHighlightCountToken(res.sentences, labels)) >
                MIN_TOKEN_GPT4 ||
            isFinal
        ) {
            SESSION.next_editor_index_to_summarise = next_index_to_summarise
            return res.sentences
        }
    }
    return undefined
}

async function detectTemplate(sentences: Sentence[]) {
    const param: SummaryParam = {
        sentences,
        title: SESSION!.project.name,
        //TODO add participants
    }
    try {
        const response = await api.detectTemplate(param)

        const agenda = await api.getAgendaWithName(response.meeting_template)
        console.log('[detectTemplate]', agenda)
        return agenda
    } catch (e) {
        console.error('error detecting template', e)
        return await api.getDefaultAgenda()
    }
}

async function autoHighlightCountToken(
    sentences: Sentence[],
    labels: string[],
): Promise<number> {
    const res: SummaryParam = {
        labels: labels,
        sentences,
        lang: parameters.language,
    }
    const count = await api.autoHighlightCount(res)

    console.log('[autoHighlightCountToken]', count)
    return count
}

async function autoHighlight(agenda: Agenda, sentences: Sentence[]) {
    const labels = extractLabels(agenda)
    if (labels.length > 0) {
        const res: SummaryParam = {
            labels: labels,
            sentences,
            lang: parameters.language,
            context: CONTEXT,
        }
        const highlights: AutoHighlightResponse = await api.autoHighlight(res)
        CONTEXT.clips = R.concat(CONTEXT.clips, highlights.clips)
        console.log('[autoHighlight]', highlights)

        for (const clip of highlights.clips) {
            let label = findLabel(agenda, clip.label)
            if (label == null) {
                label = await createLabel(clip.label)
            }

            // do not take into accounts too short clips
            if (clip.end_timestamp - clip.start_timestamp > 2.0) {
                await api.postClipitem(
                    {
                        notes: [],
                        in_time: clip.start_timestamp,
                        out_time: clip.end_timestamp,
                        label_ids: [label.id],
                        summary: clip.summary,
                    },
                    SESSION!.project.id,
                    SESSION!.asset.id,
                )
            }
        }
    }
}

export function findLabel(agenda: Agenda, label: string): Label | undefined {
    return (
        R.find(
            (b: any) =>
                b.type === 'talkingpoint' &&
                b.data.name !== '' &&
                b.data.name === label,
            agenda.json.blocks,
        )?.data as any
    )?.label
}
export function extractLabels(agenda: Agenda): string[] {
    return agenda.json.blocks
        .filter((b) => b.type === 'talkingpoint' && b.data.name !== '')
        .map((t) => (t.data as any).name)
}

export async function createLabel(name?: string) {
    return await api.postLabel({
        name: name ?? '',
        color: LABEL_COLORS[
            Math.floor(Math.random() * 100) % LABEL_COLORS.length
        ],
    })
}
