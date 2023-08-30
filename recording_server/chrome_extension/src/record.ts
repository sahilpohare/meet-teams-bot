import * as R from 'ramda'
import * as asyncLib from 'async'
import { Transcriber } from './Transcribe/streaming'
import {
    Agenda,
    Editor,
    RecognizerWord,
    Transcript,
    UseCredit,
    Video,
    Word,
    EditorWrapper,
    Asset,
    Project,
    api,
} from 'spoke_api_js'
import { Asset, Project, api } from 'spoke_api_js'
import { EditorWrapper } from 'spoke_api_js'
import { SPEAKERS } from './background'
import { SPEAKERS, parameters } from './background'
import { newSerialQueue } from './queue'
import { sleep } from './utils'

const STREAM: MediaStream | null = null
let RECORDED_CHUNKS: BlobEvent[] = []
let MEDIA_RECORDER: MediaRecorder // MediaRecorder instance to capture footage
let THIS_STREAM: MediaStreamAudioSourceNode

export let VIDEO_SIZE: VideoSize
export let CONTEXT: AudioContext
export let START_RECORD_OFFSET = 0
export let START_RECORD_TIMESTAMP = 0
export let SESSION: SpokeSession | null = null

export type SpokeSession = {
    id: number
    upload_queue: asyncLib.AsyncQueue<() => Promise<void>>
    project: Project
    video_informations: VideoInformation[]
    start_timestamp: number
    cut_times: number[]
    video_size: VideoSize
    asset: Asset
    words: RecognizerWord[]
    next_editor_index_to_summarise: number
    //last word transcribe time
    transcribed_until: number
    // complete_video_file_path: string,
    next_editor_index_to_highlight: number
}

export type VideoInformation = {
    video_size: VideoSize
    words: Word[]
    credit?: UseCredit
    s3_path?: string
    thumbnail_path?: string
    video_duration: number
    complete_editor?: EditorWrapper
    video_chunk_path?: string
    // is relative to start of the video (not a timestamp)
    tcin: number
    // is relative to start of the video (not a timestamp)
    tcout: number
    // is a timestamp
    cutStart: number
    // is a timestamp
    cutEnd: number
    speaker_name: string
}

type VideoSize = {
    width: number | undefined
    height: number | undefined
}

export async function initMediaRecorder(): Promise<void> {
    const width = 1280
    const fps = 30
    const height = 720

    return new Promise((resolve, reject) => {
        chrome.tabCapture.capture(
            {
                video: true,
                audio: true,
                videoConstraints: {
                    mandatory: {
                        chromeMediaSource: 'tab',
                        minWidth: width,
                        minHeight: height,
                        maxWidth: width,
                        maxHeight: height,
                        maxFrameRate: fps,
                    },
                },
            },
            function (stream) {
                if (stream == null) {
                    reject()
                    return
                }

                // Combine tab and microphone audio
                // Keep playing tab audio
                CONTEXT = new AudioContext()
                THIS_STREAM = CONTEXT.createMediaStreamSource(stream)
                THIS_STREAM.connect(CONTEXT.destination)
                VIDEO_SIZE = {
                    height: stream.getVideoTracks()[0].getSettings().height,
                    width: stream.getVideoTracks()[0].getSettings().width,
                }

                try {
                    MEDIA_RECORDER = new MediaRecorder(stream, {
                        mimeType: 'video/webm; codecs=h264,pcm',
                    })
                } catch (e) {
                    console.error('error creating media recorder', e)
                    reject(e)
                    return
                }

                console.log('Initing')
                Transcriber.init(new MediaStream(stream.getAudioTracks()))
                    .then(() => {
                        console.log('Inited')
                        MEDIA_RECORDER.ondataavailable = handleDataAvailable()
                        MEDIA_RECORDER.onstop = handleStop
                        resolve()
                    })
                    .catch((e) => {
                        console.error(
                            'an error occured in streaming transcribe',
                            e,
                        )
                        reject()
                    })
            },
        )
    })
}

export async function startRecording(
    projectName: string,
    agenda?: Agenda,
): Promise<Project> {
    const newSessionId = await api.startRecordingSession()
    console.log(`[startRecording]`, { newSessionId })

    console.log(`before post project`)
    let agendaRefreshed = agenda
    if (agendaRefreshed != null) {
        try {
            agendaRefreshed = await api.getAgenda(agendaRefreshed.share_link)
        } catch (e) {
            console.error('error refreshing agenda', e)
        }
    } else {
        agendaRefreshed = { json: { blocks: [] } } as any as Agenda
    }
    agendaRefreshed.json.blocks = agendaRefreshed.json.blocks.filter(
        (block: any) => block.type !== 'paragraph',
    )
    const project = await api.postProject({
        name: projectName,
        template: agendaRefreshed.json,
        original_agenda_id: agendaRefreshed.id,
        meeting_provider: parameters.meeting_provider,
    })
    console.log(`after post project`)
    const asset = await api.postAsset(
        {
            name: projectName,
            project_id: project.id,
            uploading: true,
            is_meeting_bot: true,
        },
        true,
    )

    console.log(`after post asset`)
    const date = new Date()
    const now = date.getTime()
    const newSession = {
        upload_queue: newSerialQueue(),
        project,
        id: newSessionId,
        video_informations: [],
        cut_times: [now],
        start_timestamp: now,
        video_size: VIDEO_SIZE,
        asset,
        words: [],
        next_editor_index_to_summarise: 0,
        transcribed_until: 0,
        next_editor_index_to_highlight: 0,
        // complete_video_file_path,
    }

    SESSION = newSession

    // console.log(`before media recorder start`)
    MEDIA_RECORDER.start(3000)
    MEDIA_RECORDER.onerror = function (e) {
        console.error('media recorder error', e)
    }
    START_RECORD_OFFSET = now
    START_RECORD_TIMESTAMP = now
    console.log(`after media recorder start`)

    return project
}

let HANDLE_STOP_DONE = false

async function handleStop(this: MediaRecorder, _e: Event) {
    console.log('[handle stop]')
    const spokeSession = SESSION!
    // console.log('[handle stop]', spokeSession)
    if (spokeSession) {
        const lastIndex = spokeSession.cut_times.length - 1
        const first = spokeSession.cut_times[lastIndex]
        const cutEndTimestamp = new Date().getTime()
        const lastSpeaker = SPEAKERS[SPEAKERS.length - 1]
        console.log(
            '[handle stop]',
            lastIndex,
            first,
            cutEndTimestamp,
            lastSpeaker,
        )
        await handleChunk(first, cutEndTimestamp, true, lastSpeaker.name)
        console.log('[handle stop]', {
            durationMoment: cutEndTimestamp - first,
        })
        if (cutEndTimestamp - first < MIN_DURATION_MOMENT) {
            spokeSession.cut_times.splice(lastIndex, 1)
        }
    }

    HANDLE_STOP_DONE = true
    // saveDataChunksToFile(RECORDED_CHUNKS)
}

export async function stop() {
    console.log('media recorder stop')
    MEDIA_RECORDER.stop()
    console.log('unset all stream')
    unsetAllStream()

    while (!HANDLE_STOP_DONE) {
        await sleep(1000)
    }
}

export async function waitUntilComplete(kill = false) {
    const spokeSession = SESSION!

    if (spokeSession.project) {
        await api.patchProject({
            id: spokeSession.project.id,
            moment_pending:
                SPEAKERS.length - spokeSession.video_informations.length,
        })
    }
    console.log('[waitForUpload]', 'after patch moment pending')

    if (kill) {
        console.log('[waitForUpload] killing')
        spokeSession.upload_queue.kill()
    } else {
        console.log(
            '[waitForUpload] upload queue',
            spokeSession.upload_queue.idle(),
        )
        spokeSession.upload_queue.push(async () => {
            return
        })
        await spokeSession.upload_queue.drain()
        console.log('[waitForUpload]', 'after transcribe queue drain')
    }
    // "Your video is available online"
    await stopRecordServer(spokeSession)
}

async function unsetAllStream(): Promise<void> {
    STREAM?.getTracks().forEach((track) => track.stop())
    await CONTEXT?.close()
}

const DURATION_MAX_SPEAKER = 180

function handleDataAvailable() {
    return (e: BlobEvent) => {
        const spokeSession = SESSION!
        const first = spokeSession.cut_times[spokeSession.cut_times.length - 1]
        const last = new Date().getTime()
        console.log('RECORDING TIMESTAMP', e.timecode)

        RECORDED_CHUNKS.push(e)
        const lastSpeaker = SPEAKERS[SPEAKERS.length - 1]
        const speakerChanged =
            first &&
            lastSpeaker &&
            lastSpeaker.timestamp > first &&
            lastSpeaker.timestamp < last
        const durationSecond = (last - first) / 1000
        if (first && speakerChanged && SPEAKERS.length >= 2) {
            const prevSpeaker = SPEAKERS[SPEAKERS.length - 2]
            const cutEndTimestamp = lastSpeaker.timestamp
            spokeSession.cut_times.push(cutEndTimestamp)
            handleChunk(first, cutEndTimestamp, false, prevSpeaker.name)
        } else if (durationSecond && durationSecond > DURATION_MAX_SPEAKER) {
            const prevSpeaker = SPEAKERS[SPEAKERS.length - 1]
            const cutEndTimestamp = last
            spokeSession.cut_times.push(cutEndTimestamp)
            handleChunk(first, cutEndTimestamp, false, prevSpeaker.name)
        }
    }
}

async function handleChunk(
    cutStart: number,
    cutEnd: number,
    isFinal: boolean,
    speakerName: string,
) {
    const spokeSession = SESSION!
    console.log('[handleChunk]', cutStart, cutEnd, isFinal, speakerName)
    const recordedChunks = RECORDED_CHUNKS
    RECORDED_CHUNKS = []

    const tcin = (cutStart - spokeSession.start_timestamp!) / 1000
    const tcout = (cutEnd - spokeSession.start_timestamp!) / 1000
    const videoDuration = (cutEnd - cutStart) / 1000
    spokeSession.video_informations.push({
        video_size: spokeSession.video_size,
        video_duration: videoDuration,
        cutStart,
        cutEnd,
        tcin,
        tcout,
        words: [],
        speaker_name: speakerName,
    })
    const videoInformationIndex = spokeSession.video_informations.length - 1

    const recordedDataChunk = recordedChunks.map((c) => c.data)
    const blob = new Blob(recordedDataChunk, {
        type: 'video/webm; codecs=pcm',
    })
    const file = new File([blob], 'record.webm', {
        type: 'video/webm',
    })
    spokeSession.upload_queue.push(async () => {
        await sendDataChunks(spokeSession, file, videoInformationIndex, isFinal)
    })
}

export const MIN_DURATION_MOMENT = 2100
export async function stopRecordServer(
    spokeSession: SpokeSession | null = null,
) {
    if (spokeSession) {
        await api.destroyRecordingSession(
            spokeSession.id,
            spokeSession.project?.id,
            true,
        )
        await api.patchProject({
            id: spokeSession.project.id,
            moment_pending: 0,
        })
    }
}

export async function sendDataChunks(
    spokeSession: SpokeSession,
    file: File,
    videoInformationIndex: number,
    isFinal: boolean,
) {
    try {
        const video_info =
            spokeSession.video_informations[videoInformationIndex]

        if (video_info.s3_path == null) {
            console.log(`[resuming ${videoInformationIndex}] uploadVideoChunk`)
            try {
                video_info.s3_path = await api.uploadVideoChunk(
                    file,
                    isFinal,
                    SESSION!.id,
                    videoInformationIndex,
                    spokeSession.project.id,
                    false,
                )
            } catch (e) {
                await setUploadError(
                    spokeSession.asset.id,
                    (e as any)?.response?.data ?? e,
                )
                console.log('Error in upload chunk killing')
                spokeSession.upload_queue.kill()
                return
            }
        }

        await uploadEditorsTask(spokeSession, videoInformationIndex, video_info)

        if (
            noTranscriptSinceTooLong(spokeSession) ||
            (video_info.cutEnd - spokeSession.start_timestamp!) / 1000 >
                60 * 60 * 3
        ) {
            let params = {
                session_id: parameters.session_id,
                user_token: parameters.user_token,
            }
            console.log('no speaker since too long')
            api.stopBot(params)
            return
        }
    } catch (e) {
        if ((e as any).response && (e as any).response.data) {
            console.log((e as any).response.data)
        } else {
            console.log(e)
        }
    }
}

async function setUploadError(
    asset_id: number,
    upload_error: string,
): Promise<void> {
    return await api.patchAsset({ upload_error, id: asset_id })
}

function noTranscriptSinceTooLong(spokeSession: SpokeSession) {
    const MAX_NO_TRANSCRIPT = 5
    let counter = 0
    let prevSpeakerName: string | null = null
    for (const v of spokeSession.video_informations) {
        if (
            v.video_duration > 120 &&
            v.words.length === 0 &&
            (prevSpeakerName == null || v.speaker_name === prevSpeakerName)
        ) {
            console.log({ counter })
            counter++
            if (counter > MAX_NO_TRANSCRIPT) {
                return true
            }
        } else {
            prevSpeakerName = null
            counter = 0
        }
        prevSpeakerName = v.speaker_name
    }
    return false
}

// 2000 milis
const MIN_DURTATION_EXTRACT = 2

async function uploadEditorsTask(
    spokeSession: SpokeSession,
    videoInformationIndex: number,
    videoInfo: VideoInformation,
) {
    if (videoInfo.thumbnail_path == null) {
        if (
            videoInformationIndex > 0 &&
            spokeSession.video_informations[0].thumbnail_path != null
        ) {
            videoInfo.thumbnail_path =
                spokeSession.video_informations[0].thumbnail_path
        } else {
            console.log(`[resuming] extract audio and image`)
            if (videoInfo.tcout - videoInfo.tcin > MIN_DURTATION_EXTRACT) {
                try {
                    const extract = await api.extractAudioAndImage(
                        videoInfo.tcin,
                        videoInfo.tcout,
                        true,
                        SESSION!.id,
                    )
                    spokeSession.video_informations[0].thumbnail_path =
                        extract.image_s3_path
                } catch (e) {
                    console.error('error extracting image: ', e)
                }
                try {
                    const preview = await api.generatePreview(SESSION!.id)

                    await api.patchProject({
                        id: spokeSession.project.id,
                        complete_preview_path: preview.s3_path,
                    })
                } catch (e) {
                    console.error('error generating preview: ', e)
                }
            } else {
                videoInfo.thumbnail_path = ''
            }
        }
    }

    if (videoInfo.complete_editor == null) {
        console.log(`[resuming] uploadCompleteEditor`)
        try {
            const postableCompleteEditor = createEditorWrapper(
                videoInfo as Required<VideoInformation>,
                spokeSession.project.id,
                spokeSession.asset,
            )
            const completeEditor = await api.postCompleteEditor(
                postableCompleteEditor,
            )
            videoInfo.complete_editor = completeEditor

            await api.patchProject({
                id: spokeSession.project.id,
                moment_pending:
                    spokeSession.cut_times.length -
                    completeEditorUploadedCount(spokeSession),
            })
        } catch (e) {
            console.error('[uploadEditorTasks] error posting editor', e)
        }
    }
}

function createEditorWrapper(
    videoInfo: VideoInformation,
    projectId: number,
    asset: Asset,
): EditorWrapper {
    return {
        editor: createEditor(videoInfo, projectId) as Editor,
        video: createVideo(videoInfo, asset) as Video,
    }
}

function createEditor(
    _videoInfo: VideoInformation,
    projectId: number,
): Partial<Editor> {
    return {
        index: 0,
        project_id: projectId,
        clipitems: [],
    } as Partial<Editor>
}

function createVideo(
    videoInfo: VideoInformation,
    asset: Asset,
): Partial<Video> {
    return {
        no_credit: false,
        s3_path: videoInfo.s3_path,
        transcripts: createTranscripts(videoInfo) as Transcript[],
        thumbnail_path: videoInfo.thumbnail_path,
        duration: videoInfo.video_duration,
        width: videoInfo.video_size.width || 1920,
        height: videoInfo.video_size.height || 1080,
        audio_offset: videoInfo.tcin,
        asset_id: asset.id,
        transcription_completed: false,
    }
}

function createTranscripts(videoInfo: VideoInformation): Partial<Transcript>[] {
    const transcripts = [
        {
            speaker: videoInfo.speaker_name,
            words: [],
            google_lang: parameters.language,
        },
    ]
    return transcripts
}

export function completeEditorUploadedCount(session: SpokeSession): number {
    let completeEditorCount = R.countBy((info) => {
        return info.complete_editor != null ? 'complete' : 'incomplete'
    }, session.video_informations)['complete']
    if (!completeEditorCount) {
        completeEditorCount = 0
    }
    return completeEditorCount
}
