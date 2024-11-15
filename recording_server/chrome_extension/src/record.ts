import * as asyncLib from 'async'
import { ApiService, sleep } from './api'
import { SoundStreamer } from './sound_streamer'

const STREAM: MediaStream | null = null
let RECORDED_CHUNKS: BlobEvent[] = []
let MEDIA_RECORDER: MediaRecorder // MediaRecorder instance to capture footage
let HANDLE_STOP_DONE = false
let CONTEXT: AudioContext | null = null // No streaming_output audio mode
let THIS_STREAM: MediaStreamAudioSourceNode | null = null // No streaming_output audio mode

export let SESSION: SpokeSession | null = null

export type SpokeSession = {
    upload_queue: asyncLib.AsyncQueue<() => Promise<void>>
}

function newSerialQueue() {
    return asyncLib.queue(async function (
        task: () => Promise<void>,
        done: any,
    ) {
        await task()
        done()
    },
    1)
}

export async function initMediaRecorder(
    streaming_output: string | undefined,
    streaming_audio_frequency: number | undefined,
): Promise<void> {
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
                        minWidth: 1280,
                        minHeight: 720,
                        maxWidth: 1280,
                        maxHeight: 720,
                    },
                },
            },
            function (stream) {
                if (stream == null) {
                    reject()
                    return
                }

                if (streaming_output) {
                    new SoundStreamer()
                    SoundStreamer.instance.start(
                        stream,
                        streaming_audio_frequency,
                    )
                } else {
                    CONTEXT = new AudioContext()
                    THIS_STREAM = CONTEXT!.createMediaStreamSource(stream)
                    THIS_STREAM!.connect(CONTEXT!.destination)
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

                try {
                    MEDIA_RECORDER.ondataavailable = handleDataAvailable()
                    MEDIA_RECORDER.onstop = handleStop
                } catch (e) {
                    console.error('error starting media recorder', e)
                    reject()
                }
                resolve()
            },
        )
    })
}

export async function startRecording(): Promise<number> {
    const events = new Promise<number>((resolve, reject) => {
        MEDIA_RECORDER.onerror = function (e) {
            console.error('media recorder error', e)
            reject('Error on MEDIA_RECORDER')
        }
        MEDIA_RECORDER.onstart = function (_e) {
            const start_recording_timestamp = Date.now()
            const newSession = {
                upload_queue: newSerialQueue(),
                cut_times: [start_recording_timestamp],
                start_timestamp: start_recording_timestamp,
                transcripts: [],
                words: [],
            }
            SESSION = newSession
            resolve(start_recording_timestamp)
        }
    })
    MEDIA_RECORDER.start(10000)

    return await events
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
        await spokeSession.upload_queue.push(async () => {
            return
        })
        await spokeSession.upload_queue.drain()
        console.log('[waitForUpload] after transcribe queue drain')
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
