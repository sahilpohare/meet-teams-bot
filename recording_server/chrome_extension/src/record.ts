import * as asyncLib from 'async'
import { parameters } from './background'
import { newSerialQueue } from './queue'
import {
    Agenda,
    api,
    Asset,
    EditorWrapper,
    Project,
    RecognizerWord,
} from './api'
import { sleep } from './api'
import { Transcriber } from './Transcribe/Transcriber'
import { SoundStreamer } from './sound_streamer'

const STREAM: MediaStream | null = null
let RECORDED_CHUNKS: BlobEvent[] = []
let MEDIA_RECORDER: MediaRecorder // MediaRecorder instance to capture footage
let HANDLE_STOP_DONE = false
let CONTEXT: AudioContext

// TODO : Dead code ?
// let START_RECORD_OFFSET = 0
// TODO : Dead code ?
// export const MIN_DURATION_MOMENT = 2100

// INFO : START_RECORD_TIMESTAMP is shared with Transcriber & UploadEditors(speaker changes)
export let START_RECORD_TIMESTAMP = 0
// INFO : SESSION is shared with Transcriber & UploadEditors(speaker changes)
export let SESSION: SpokeSession | null = null

export type SpokeSession = {
    id: number
    upload_queue: asyncLib.AsyncQueue<() => Promise<void>>
    project: Project
    completeEditors: EditorWrapper[]
    start_timestamp: number
    cut_times: number[]
    asset: Asset
    words: RecognizerWord[]
    videoS3Path?: string
    thumbnailPath?: string
    //last word transcribe time
    // complete_video_file_path: string,
    uploadChunkCounter: number
    transcribedUntil: number
}

// TODO : Dead code ? Why this type is never used ?
// type VideoSize = {
//     width: number | undefined
//     height: number | undefined
// }

export async function initMediaRecorder(): Promise<void> {
    const fps = 30

    return new Promise((resolve, reject) => {
        chrome.tabCapture.capture(
            {
                video: true,
                audio: true,
                videoConstraints: {
                    mandatory: {
                        chromeMediaSource: 'tab',
                        maxFrameRate: fps,
                    },
                },
            },
            function (stream) {
                if (stream == null) {
                    reject()
                    return
                }

                new SoundStreamer()
                SoundStreamer.instance.start(stream)

                try {
                    MEDIA_RECORDER = new MediaRecorder(stream, {
                        mimeType: 'video/webm; codecs=h264,pcm',
                    })
                } catch (e) {
                    console.error('error creating media recorder', e)
                    reject(e)
                    return
                }

                Transcriber.init()
                    .then(() => {
                        try {
                            MEDIA_RECORDER.ondataavailable =
                                handleDataAvailable()
                            MEDIA_RECORDER.onstop = handleStop
                        } catch (e) {
                            console.error('error starting media recorder', e)
                            throw e
                        }
                        resolve()
                    })
                    .catch((e) => {
                        console.error('an error occured in transcriber init', e)
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
    console.log('[startRecording]: '.concat(newSessionId.toLocaleString()))

    console.log(`[startRecording] before post project`)
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
        meeting_provider: parameters.meetingProvider,
    })
    console.log(`[startRecording] after post project`)
    const asset = await api.postAsset(
        {
            name: projectName,
            project_id: project.id,
            uploading: true,
            is_meeting_bot: true,
        },
        true,
    )

    console.log(`[startRecording] after post asset`)

    MEDIA_RECORDER.onerror = function (e) {
        console.error('media recorder error', e)
    }
    MEDIA_RECORDER.onstart = function (_e) {
        const now = Date.now()
        const newSession = {
            upload_queue: newSerialQueue(),
            project,
            id: newSessionId,
            cut_times: [now],
            start_timestamp: now,
            asset,
            completeEditors: [],
            words: [],
            uploadChunkCounter: 0,
            transcribedUntil: 0,
        }
        SESSION = newSession
        START_RECORD_TIMESTAMP = now
    }
    MEDIA_RECORDER.start(10000)
    // TODO : Dead code ? START_RECORD_OFFSET is only SET here but never read
    // START_RECORD_OFFSET = CONTEXT.currentTime
    console.log(`after media recorder start`)

    return project
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
        try {
            await api.patchProject({
                id: spokeSession.project.id,
                moment_pending: 1,
            })
        } catch (e) {
            console.error('error patching project', e)
        }
    }
    console.log('[waitForUpload]'.concat('after patch moment pending'))

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
        console.log('[waitForUpload] after transcribe queue drain')
    }
}

export async function stopRecordServer(
    spokeSession: SpokeSession | null = null,
) {
    if (spokeSession) {
        await api.destroyRecordingSession(
            spokeSession.id,
            spokeSession.project?.id,
            true,
            parameters.bot_id,
        )
        await api.patchProject({
            id: spokeSession.project.id,
            moment_pending: 0,
        })
    }
}

async function handleStop(this: MediaRecorder, _e: Event) {
    console.log('[handle stop]')
    const spokeSession = SESSION!
    if (spokeSession) {
        await handleChunk(true)
    }

    HANDLE_STOP_DONE = true
}

async function unsetAllStream(): Promise<void> {
    STREAM?.getTracks().forEach((track) => track.stop())
    await CONTEXT?.close()
}

function handleDataAvailable() {
    return (e: BlobEvent) => {
        RECORDED_CHUNKS.push(e)
        handleChunk(false)
    }
}

async function handleChunk(isFinal: boolean) {
    const spokeSession = SESSION! // ! is the equivalent of unwrap() - throw exception
    const recordedChunks = RECORDED_CHUNKS
    RECORDED_CHUNKS = []
    const index = spokeSession.uploadChunkCounter
    spokeSession.uploadChunkCounter += 1

    const recordedDataChunk = recordedChunks.map((c) => c.data)
    const blob = new Blob(recordedDataChunk, {
        type: 'video/webm; codecs=pcm',
    })
    const file = new File([blob], 'record.webm', {
        type: 'video/webm',
    })
    spokeSession.upload_queue.push(async () => {
        await sendDataChunks(spokeSession, file, index, isFinal)
    })
}

async function sendDataChunks(
    spokeSession: SpokeSession,
    file: File,
    index: number,
    isFinal: boolean,
) {
    try {
        try {
            spokeSession.videoS3Path = await api.uploadVideoChunk(
                file,
                isFinal,
                SESSION!.id,
                index,
                spokeSession.project.id,
                false,
            )
        } catch (e) {
            await setUploadError(
                spokeSession.asset.id,
                (e as any)?.response?.data ??
                    'An error occured while uploading the video',
            )
            console.log('Error in upload chunk killing')
            spokeSession.upload_queue.kill()
            return
        }
    } catch (e) {
        if ((e as any).response && (e as any).response.data) {
            console.log((e as any).response.data)
        } else {
            console.log(e as any)
        }
    }
}

async function setUploadError(
    asset_id: number,
    upload_error: string,
): Promise<void> {
    return await api.patchAsset({ upload_error, id: asset_id })
}
