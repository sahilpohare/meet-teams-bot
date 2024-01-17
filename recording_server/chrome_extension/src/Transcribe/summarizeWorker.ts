import { Transcriber } from './Transcriber'
import * as R from 'ramda'
import { ATTENDEES, parameters } from '../background'
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
    Workspace,
    DetectClientResponse,
    TypedLabel,
} from 'spoke_api_js'

const MIN_TOKEN_GPT4 = 1000

export async function summarizeWorker(): Promise<void> {
    let i = 1
    let isFirst = true

    while (!Transcriber.TRANSCRIBER?.stopped && isFirst) {
        if (SESSION) {
            if (i % 10 === 0) {
                try {
                    if (await tryDetectClientAndTemplate(isFirst, false)) {
                        isFirst = false
                    }
                } catch (e) {
                    console.log(e, 'summarize failed')
                }
            }
            i++
        }

        await sleep(3_000)
    }
    if (isFirst) {
        await tryDetectClientAndTemplate(isFirst, true)
    }
}

export async function summarize() {
    console.log('[summarize]', parameters.agenda)
    if (parameters.agenda) {
        const agenda = await api.getAgendaWithId(parameters.agenda.id)

        let useFunctionCalling = true
        await autoHighlight(useFunctionCalling, agenda)
        try {
            await api.notifyApp(parameters.user_token, {
                message: 'RefreshProject',
                user_id: parameters.user_id,
                payload: { project_id: SESSION?.project.id },
            })
        } catch (e) {
            console.error('notify failed', e)
        }
    }
}

async function useNewAi(): Promise<boolean> {
    const workspaceId = SESSION?.project.workspace_id
    if (workspaceId == null) {
        console.error('workspaceId is null')
        return false
    }
    const subscriptions = await api.getSubscriptionInfos(workspaceId)
    console.log('payer', subscriptions?.payer)

    return subscriptions?.payer.appsumoPlanId == null
}

// detect who is the client in the meeting and who is the spoker
async function detectClients(sentences: Sentence[]): Promise<string[]> {
    let clients = ATTENDEES
    if (ATTENDEES.length > 0) {
        const allWorkspaces: Workspace[] = await api.getAllWorkspaces()
        for (const w of allWorkspaces) {
            for (const m of w.members) {
                for (const attendee of clients) {
                    if (
                        m.firstname != null &&
                        m.lastname != null &&
                        attendee
                            .toLowerCase()
                            .includes(m.firstname.toLowerCase()) &&
                        attendee
                            .toLowerCase()
                            .includes(m.lastname.toLowerCase())
                    ) {
                        clients = clients.filter((c) => c !== attendee)
                    }
                }
            }
        }
        return clients
    } else {
        const param: SummaryParam = {
            sentences,
        }
        const res: DetectClientResponse = await api.detectClient(param)
        return res.client_names
    }
}

let CLIENTS: string[] = []

async function tryDetectClientAndTemplate(
    isFirst: boolean,
    isFinal: boolean,
): Promise<boolean> {
    if (SESSION) {
        const collect = await collectSentenceToAutoHighlight(isFinal)

        if (isFirst && collect != null && collect.length > 0) {
            try {
                CLIENTS = await detectClients(collect)
                await api.patchProject({
                    id: SESSION.project.id,
                    client_name: CLIENTS.join(', '),
                })
            } catch (e) {
                console.error('error detecting client', e)
            }
            if (!parameters.agenda) {
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
            }
            return true
        }
    }

    return false
}

async function collectSentenceToAutoHighlight(
    isFinal: boolean,
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
                (await autoHighlightCountToken(res.sentences)) > MIN_TOKEN_GPT4
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
            (await autoHighlightCountToken(res.sentences)) > MIN_TOKEN_GPT4 ||
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

async function autoHighlightCountToken(sentences: Sentence[]): Promise<number> {
    const res: SummaryParam = {
        labels: [],
        sentences,
        lang: parameters.language,
    }
    const count = await api.autoHighlightCount(res)

    console.log('[autoHighlightCountToken]', count)
    return count
}

async function autoHighlight(useFunctionCalling: boolean, agenda: Agenda) {
    const labels = getTemplateLabels(agenda)
    console.log('[autoHighlight]', labels)
    if (labels.length > 0) {
        let typed_labels = (
            await Promise.all(
                labels.map(async (l) => {
                    try {
                        const label = await api.getLabel(l.id)
                        return label
                    } catch (e) {
                        console.error('error getting label', e)
                        return null
                    }
                }),
            )
        ).filter((l) => l != null) as Label[]
        console.log('[autoHighlight] typed_labels', typed_labels)
        const res: SummaryParam = {
            labels: labels.map((l) => l.name),
            project_id: SESSION!.project.id,
            sentences: [],
            test_gpt4: useFunctionCalling,
            lang: parameters.language,
            client_name: CLIENTS.length > 0 ? CLIENTS.join(', ') : undefined,
            typed_labels: typed_labels as unknown as TypedLabel[],
        }
        console.log('[autoHighlight] res', res)
        const highlights: AutoHighlightResponse = await api.autoHighlight(res)
        console.log('[autoHighlight] highlights', highlights)

        for (const clip of highlights.clips) {
            try {
                let label = findLabel(agenda, clip.label)
                if (label == null) {
                    label = await createLabel(clip.label)
                }

                // do not take into accounts too short clips
                try {
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
                } catch (e) {
                    console.error('error postClipitem', e)
                }
            } catch (e) {
                console.error('could not find or createlabel', e)
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

export function getTemplateLabels(agenda: Agenda): Label[] {
    return R.flatten(
        agenda?.json.blocks?.map((b) => {
            if (b.type === 'talkingpoint') {
                return b.data.label
            } else {
                return undefined
            }
        }),
    ).filter((l) => l != null) as Label[]
}

export async function createLabel(name?: string) {
    return await api.postLabel({
        name: name ?? '',
        color: LABEL_COLORS[
            Math.floor(Math.random() * 100) % LABEL_COLORS.length
        ],
    })
}
