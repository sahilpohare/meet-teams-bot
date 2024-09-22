import * as asyncLib from 'async'
import { RecognizerWord, sleep, Transcript } from './api'
import { parameters } from './background'
import { newSerialQueue } from './queue'
import { ApiService } from './recordingServerApi'
import { Transcriber } from './Transcribe/Transcriber'

const STREAM: MediaStream | null = null
let RECORDED_CHUNKS: BlobEvent[] = []
let MEDIA_RECORDER: MediaRecorder // MediaRecorder instance to capture footage
let THIS_STREAM: MediaStreamAudioSourceNode
let HANDLE_STOP_DONE = false
let CONTEXT: AudioContext

// TODO : Dead code ?
// let START_RECORD_OFFSET = 0
// TODO : Dead code ?
// export const MIN_DURATION_MOMENT = 2100

// INFO : START_RECORD_TIMESTAMP is shared with Transcriber & UploadTranscripts(speaker changes)
export let START_RECORD_TIMESTAMP = 0
// INFO : SESSION is shared with Transcriber & UploadTranscripts(speaker changes)
export let SESSION: SpokeSession | null = null

export type SpokeSession = {
    upload_queue: asyncLib.AsyncQueue<() => Promise<void>>
    transcripts: Transcript[]
    start_timestamp: number
    cut_times: number[]
    words: RecognizerWord[]
    videoS3Path?: string
    thumbnailPath?: string
    //last word transcribe time
    // complete_video_file_path: string,
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

                // Combine tab and microphone audio
                // Keep playing tab audio
                CONTEXT = new AudioContext()
                THIS_STREAM = CONTEXT.createMediaStreamSource(stream)
                THIS_STREAM.connect(CONTEXT.destination)

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

export async function startRecording(): Promise<void> {
    await ApiService.sendMessageToRecordingServer('START_TRANSCODER', {
        bucketName: parameters.s3_bucket,
        videoS3Path: parameters.mp4_s3_path,
    })

    MEDIA_RECORDER.onerror = function (e) {
        console.error('media recorder error', e)
    }
    MEDIA_RECORDER.onstart = function (_e) {
        const now = Date.now()
        const newSession = {
            upload_queue: newSerialQueue(),
            cut_times: [now],
            start_timestamp: now,
            transcripts: [],
            words: [],
            transcribedUntil: 0,
        }
        SESSION = newSession
        START_RECORD_TIMESTAMP = now
    }
    MEDIA_RECORDER.start(10000)
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
        await ApiService.sendMessageToRecordingServer('STOP_TRANSCODER', {})
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

    const recordedDataChunk = recordedChunks.map((c) => c.data)
    const blob = new Blob(recordedDataChunk, {
        type: 'video/webm; codecs=pcm',
    })
    const file = new File([blob], 'record.webm', {
        type: 'video/webm',
    })
    spokeSession.upload_queue.push(async () => {
        await sendDataChunks(spokeSession, file, isFinal)
    })
}

async function sendDataChunks(
    spokeSession: SpokeSession,
    file: File,
    isFinal: boolean,
) {
    try {
        try {
            await ApiService.sendMessageToRecordingServer('UPLOAD_CHUNK', file)
        } catch (e) {
            // TODO: handler upload chunk error
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
