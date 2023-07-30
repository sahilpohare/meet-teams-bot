import * as R from 'ramda'
import { api, setConfig, SummaryParam, WordSummary } from 'spoke_api_js'
var fs = require('fs');
const { encode, } = require('gpt-3-encoder')

const SESSION = {
    project: {
        summary: ''
    },
    next_editor_index_to_summarise: 0,
    video_informations: [
        { speaker_name: 'John', words: [] },
    ]
}
const LANGUAGE = 'en-US'

export async function summarize() {
    setConfig({
        api_server_internal_url: 'http://localhost:3001',
        api_download_internal_url: 'http://localhost:3001',
        authorizationToken: "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.eyJpZCI6MX0.fBjp42f6dA3RM3Pue_BJhhqv0STDSiYo6WAIcfxL1J6CaS90_hZ9sXk2xjmgTCdqBgMfvbFO0qe9GbK99jFwIg",

        logError: () => { },
    })

    const onlyFinal = (process.argv[3]?.includes('only_final'))
    if (onlyFinal) {
        var tmp = fs.readFileSync('./tmp_summary.txt').toString()
        SESSION.project.summary = tmp

        read_test_file()
        await summarizeFinal()
    } else {
        read_test_file()
        while (await trySummarizeNext(true)) {
        }
        fs.writeFileSync('./tmp_summary.txt', SESSION.project.summary);
        await summarizeFinal()
    }
}

async function read_test_file() {
    var array = fs.readFileSync('./test_transcript.txt').toString().split("\n\n");
    const filtered = array.filter(el => el !== '')
    SESSION.video_informations = Array.from({ length: Math.floor(filtered.length / 2) }, (_, i) => ({ speaker_name: '', words: [] }))
    console.log({ filtered }, filtered.length)
    for (let i = 0; i < filtered.length; i++) {
        console.log(i, filtered[i])
        if (i % 2 === 0) {
            SESSION.video_informations[Math.floor(i / 2)].speaker_name = filtered[i]
        } else {
            SESSION.video_informations[Math.floor(i / 2)].words = filtered[i].split(' ').map(w => ({ text: w }))
        }
        console.log(array[i]);
    }
    console.log(SESSION)
}

async function trySummarizeNext(isFinal: boolean) {
    if (SESSION) {
        const collect = await collectSentenceToSummarize(isFinal)

        if (collect != null) {
            const summaryPart = await api.summarize(collect)
            // console.log({ summaryPart })
            if (summaryPart != null) {
                console.log({ summaryPart })
                SESSION.project.summary += SESSION.project.summary === '' ? summaryPart : '\n' + summaryPart
                // await api.patchProject({ summary: SESSION.project.summary, id: SESSION.project.id })
                return true
            }
        }
    }
    return false
}

const MIN_TOKEN = 3000
const MAX_TOKEN = 3450

async function summarizeFinal() {
    if (SESSION) {
        const sentence = SESSION.project.summary.split(' ').map(w => ({ text: w }))
        let speakers = R.uniq(SESSION?.video_informations.map(video_info => video_info.speaker_name))
        const between = speakers.length >= 2 ? `between ${speakers.join(', ')}` : ''
        const summaryParam: SummaryParam = {
            sentences: [{ speaker: '', words: sentence }],
            instruction: `Those are insights and next steps from a conversation ${between}. Group key insights in bullet points, and next steps in bullet points, while keeping the context of each item:`,
            max_token: 800,
            lang: LANGUAGE,
        }
        const summary = await api.summarize(summaryParam)
        console.log('FINAL SUMMARY: ', summary)
    }

}

async function collectSentenceToSummarize(isFinal: boolean): Promise<SummaryParam | undefined> {
    let speakers = R.uniq(SESSION?.video_informations.map(video_info => video_info.speaker_name))
    const between = speakers.length >= 2 ? `between "${speakers.join(', ')}"` : ''
    const res: SummaryParam & { fullSentence: string } = {
        sentences: [],
        fullSentence: '',
        lang: LANGUAGE,
        max_token: 250,
        instruction: `this is a conversation ${between}, give me the key insights and next steps for each speakers`
    }
    let withNextIsMaxToken = false

    if (SESSION && SESSION.next_editor_index_to_summarise < SESSION.video_informations.length) {
        const video_infos = SESSION.video_informations
        let next_index_to_summarise = SESSION.next_editor_index_to_summarise
        for (let i = SESSION.next_editor_index_to_summarise; i < video_infos.length; i++) {
            const video_info = video_infos[i]
            console.log('[collectSentenceToSummarize]', SESSION.next_editor_index_to_summarise, i)
            if (!(isFinal) || await countToken(res.fullSentence) > MIN_TOKEN) {
                break
            }
            const newFullSentence = res.fullSentence + '\n' + video_info.speaker_name + ':' + video_info.words.map(w => w.text).join(' ')
            if (await countToken(newFullSentence) > MAX_TOKEN) {
                withNextIsMaxToken = true
                break
            }
            res.sentences.push({
                speaker: video_info.speaker_name,
                words: video_info.words as WordSummary[]
                // SESSION?.video_informations[
                // } else {
            })
            res.fullSentence = newFullSentence
            next_index_to_summarise = i + 1
        }
        if (await countToken(res.fullSentence) > MIN_TOKEN || isFinal || withNextIsMaxToken) {
            SESSION.next_editor_index_to_summarise = next_index_to_summarise
            return res
        }
    }
    return undefined
}

function countToken(str: string) {
    const encoded = encode(str)
    console.log('Encoded this string looks like: ', encoded, encoded.lenght)
    return encoded.length
}
