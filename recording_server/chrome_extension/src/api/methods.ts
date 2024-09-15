import axios from 'axios'
import { API_BOT_BASEURL } from './axios'
import {
    Agenda,
    AgendaJson,
    Asset,
    DetectClientResponse,
    DetectTemplateResponse,
    EditorWrapper,
    Label,
    MeetingProvider,
    Project,
    RecognizerWord,
    SummaryParam,
    Video,
    Word,
    Workspace,
} from './types'

export async function stopBot(params: { session_id: string }) {
    try {
        const resp = await axios({
            method: 'POST',
            url: `/meeting_bot/stop_record`,
            data: params,
        })
        return resp.data
    } catch (e) {
        console.error('[stopZoom] failed to stop meeting bot session', e)
    }
}
export async function getAllWorkspaces(): Promise<Workspace[]> {
    return (await axios.get(`/workspaces`)).data
}
export async function getAgendaWithId(id: number): Promise<Agenda> {
    return (await axios.get(`/agendas/with_id/${id}`)).data
}

export async function startRecordingSession(): Promise<number> {
    const data = (
        await axios({
            method: 'POST',
            url: `${API_BOT_BASEURL}/video/start_recording_session`,
        })
    ).data
    return parseInt(data)
}

export async function destroyRecordingSession(
    sessionId: number,
    projectId: number | undefined,
    doNotSetUploading: boolean,
    botId: string | undefined,
) {
    await axios({
        method: 'POST',
        url: `${API_BOT_BASEURL}/video/destroy_recording_session`,
        params: {
            session_id: sessionId,
            project_id: projectId,
            do_not_set_uploading: doNotSetUploading,
            bot_id: botId,
        },
    })
}

export async function uploadVideoChunk(
    data: File,
    isFinal: boolean,
    sessionId: number,
    index: number,
    projectId: number,
    audioOnly: boolean,
): Promise<string> {
    // -1 is the id of the "screen" of audio only
    let resp
    resp = await axios({
        method: 'POST',
        url: `${API_BOT_BASEURL}/video/upload_chunk?is_final=${isFinal}&session_id=${sessionId}&index=${index}&audio_only=${audioOnly}&project_id=${projectId}`,
        data: data,
        raxConfig: {
            retry: 5,
        },
    })
    return resp.data
}

export type ExtractAudioAndImageResponse = {
    audio_s3_path: string
    image_s3_path: string
}

export type ExtractPreview = {
    s3_path: string
}

export async function extractAudio(
    sessionId: number,
    start_time: number,
    end_time: number,
): Promise<ExtractAudioAndImageResponse> {
    const resp = await axios({
        method: 'POST',
        url: `${API_BOT_BASEURL}/video/extract_audio?session_id=${sessionId}&cut_start=${start_time}&cut_end=${end_time}`,
    })
    return resp.data
}

export async function extractImage(
    cutStart: number,
    cutEnd: number,
    sessionId: number,
): Promise<ExtractAudioAndImageResponse> {
    const resp = await axios({
        method: 'POST',
        url: `${API_BOT_BASEURL}/video/extract_image?cut_start=${cutStart}&cut_end=${cutEnd}&session_id=${sessionId}`,
    })
    return resp.data
}

export async function generatePreview(
    sessionId: number,
): Promise<ExtractPreview> {
    const resp = await axios({
        method: 'POST',
        url: `${API_BOT_BASEURL}/video/generate_preview?session_id=${sessionId}`,
    })
    return resp.data
}

export async function deleteAudio(
    extracted: Partial<ExtractAudioAndImageResponse>,
) {
    const resp = await axios({
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        url: `${API_BOT_BASEURL}/video/delete_audio`,
        raxConfig: {
            retry: 2,
        },
        data: extracted,
    })
}
export async function getAgenda(share_link: string): Promise<Agenda> {
    return (await axios.get(`/agendas/${share_link}`)).data
}


export async function postProject(p: {
    name: string
    template?: AgendaJson
    original_agenda_id?: number
    meeting_provider?: MeetingProvider
    workspace_id?: number
    uploading?: boolean
}): Promise<Project> {
    // if name of window is no interesting take the date
    const resp = await axios({
        method: 'POST',
        url: `/projects/`,
        data: p,
    })
    const project: Project = resp.data
    return project
}

export async function postCompleteEditor(
    e: EditorWrapper,
): Promise<EditorWrapper> {
    const resp = await axios({
        method: 'POST',
        url: `/projects/editors/complete`,
        data: e,
    })
    return resp.data
}

export async function postAsset(
    data: Partial<Asset>,
    from_app: boolean,
): Promise<Asset> {
    return (
        await axios({
            method: 'POST',
            url: `/assets?from_website=${!from_app}`,
            data: data,
        })
    ).data
}

export async function patchProject(data: Partial<Project>) {
    await axios.patch(`/projects/${data.id}`, data)
}
export async function patchAsset(data: Partial<Asset>) {
    await axios.patch(`/assets/${data.id}`, data)
}

export async function detectTemplate(
    param: SummaryParam,
): Promise<DetectTemplateResponse> {
    const resp = await axios({
        raxConfig: {
            retry: 0,
        },
        method: 'POST',
        url: `/v1/speech/detect_template`,
        data: param,
    })
    return resp.data
}

export async function detectClient(
    param: SummaryParam,
): Promise<DetectClientResponse> {
    const resp = await axios({
        raxConfig: {
            retry: 0,
        },
        method: 'POST',
        url: `/v1/speech/detect_client`,
        data: param,
    })
    return resp.data
}

export type TypedLabel = {
    name: string
    typed: string | string[]
    multiple: boolean
}

export async function getAgendaWithName(name: string): Promise<Agenda> {
    return (await axios.get(`/agendas?name=${name}`)).data
}
export async function getDefaultAgenda(): Promise<Agenda> {
    return (await axios.get('/agendas/default')).data
}
export async function autoHighlightCount(param: SummaryParam): Promise<number> {
    const resp = await axios({
        method: 'POST',
        url: `/v1/speech/auto_highlight_count`,
        data: param,
    })
    return resp.data
}

export async function endMeetingTrampoline(
    project_id: number,
    bot_id?: string,
) {
    const resp = await axios({
        params: {
            project_id,
            bot_id,
        },
        raxConfig: {
            retry: 0,
        },
        method: 'POST',
        url: '/v1/speech/end_meeting_trampoline',
        timeout: 600000,
    })
    return resp.data
}

export async function patchVideo(data: Partial<Video>) {
    await axios({
        method: 'PATCH',
        url: `/projects/videos/${data.id}`,
        data,
    })
}
export async function postWord(
    word: RecognizerWord[],
    transcript_id: number,
    video_id: number,
): Promise<Word[]> {
    return (
        await axios({
            method: 'POST',
            url: `/projects/words?transcript_id=${transcript_id}&video_id=${video_id}`,
            data: word,
        })
    ).data
}

export async function postLabel(label: {
    name: string
    color: string
}): Promise<Label> {
    const resp = await axios.post('/labels', {
        name: label.name,
        color: label.color,
    })
    return resp.data
}
