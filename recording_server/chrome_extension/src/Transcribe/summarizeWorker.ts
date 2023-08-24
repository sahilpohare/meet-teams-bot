import { Transcriber } from './streaming'
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

const MIN_TOKEN = 3000
const MAX_TOKEN = 3450

const MIN_TOKEN_GPT4 = 6000
const MAX_TOKEN_GPT4 = 6500

export async function summarizeWorker(): Promise<void> {
  let i = 0

  while (!Transcriber.STOPPED) {
    if (SESSION) {
      if (i % 100 === 0) {
        try {
          await trySummarizeNext(false)
        } catch (e) {
          console.log(e, 'summarize failed')
        }
      }
      i++
    }

    await sleep(5_000)
  }
}

export async function trySummarizeNext(isFinal: boolean) {
  if (SESSION) {
    const labels = parameters.agenda ? extractLabels(parameters.agenda) : []
    const collect = await collectSentenceToAutoHighlight(isFinal, labels)
    if (collect != null && collect.length > 0) {
      if (parameters.agenda) {
        await autoHighlight(parameters.agenda, collect)
      } else {
        const agenda = await detectTemplate(collect)
        parameters.agenda = agenda

        await api.patchProject({
          id: SESSION.project.id,
          template: agenda.json,
          original_agenda_id: agenda.id,
        })
        await autoHighlight(parameters.agenda, collect)
      }
    }
  }
  return false
}

async function collectSentenceToAutoHighlight(
  isFinal: boolean,
  labels: string[],
): Promise<Sentence[] | undefined> {
  const res: SummaryParam & { fullSentence: string } = {
    sentences: [],
    fullSentence: '',
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
      console.log(
        '[collectSentenceToSummarize]',
        SESSION.next_editor_index_to_summarise,
        i,
        SESSION.transcribed_until,
        video_info.tcout,
      )
      if (
        !(SESSION.transcribed_until >= video_info.tcout || isFinal) ||
        (await autoHighlightCountToken(res.sentences, labels)) >
        MIN_TOKEN_GPT4
      ) {
        break
      }
      const newFullSentence =
        res.fullSentence +
        '\n' +
        video_info.speaker_name +
        ':' +
        video_info.words.map((w) => w.text).join(' ')
      if (
        (await autoHighlightCountToken(res.sentences, labels)) >
        MAX_TOKEN_GPT4
      ) {
        withNextIsMaxToken = true
        break
      }
      if (video_info.words.length > 0) {
        res.sentences.push({
          speaker: video_info.speaker_name,
          words: video_info.words.map((w) => ({ text: w.text! })),
          start_timestamp: video_info.words[0].start_time,
          end_timestamp:
            video_info.words[video_info.words.length - 1].end_time,
          // SESSION?.video_informations[
          // } else {
        })
        res.fullSentence = newFullSentence
      }
      next_index_to_summarise = i + 1
    }
    if (
      (await autoHighlightCountToken(res.sentences, labels)) >
      MIN_TOKEN_GPT4 ||
      isFinal ||
      withNextIsMaxToken
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
    }
    const highlights: AutoHighlightResponse = await api.autoHighlight(res)
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
  return R.find(
    (b: any) =>
      b.type === 'talkingpoint' &&
      b.data.name !== '' &&
      b.data.name === label,
    agenda.json.blocks,
  )?.data.label
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
