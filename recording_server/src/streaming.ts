import { RawData, Server, WebSocket } from 'ws'
import { IncomingMessage } from 'http'
import { Readable } from 'stream'

import { SpeakerData } from './types'
import { SoundContext } from './media_context'

const EXTENSION_WEBSOCKET_PORT: number = 8081
const SAMPLE_RATE: number = 16_000

export class Streaming {
    public static instance: Streaming | null

    private extension_ws: Server<
        typeof WebSocket,
        typeof IncomingMessage
    > | null
    private output_ws: WebSocket | null = null // May be used as dual channel, input and output
    private input_ws: WebSocket | null = null

    constructor(
        input: string | undefined,
        output: string | undefined,
        bot_id: string,
    ) {
        if (output) {
            console.info(`${this.constructor.name} : output = ${output}`)
            this.extension_ws = new WebSocket.Server({
                port: EXTENSION_WEBSOCKET_PORT,
            })

            // Event 'connection' on client extension WebSocket
            this.extension_ws.on('connection', (client: WebSocket) => {
                console.log(`${this.constructor.name} : Client connected`)

                this.output_ws = new WebSocket(output)
                // Send initial message to output webSocket
                this.output_ws.on('open', () => {
                    this.output_ws.send(
                        JSON.stringify({
                            protocol_version: 1,
                            bot_id,
                            offset: 0.0,
                        }),
                    )
                })
                // Dual channel
                if (input === output) {
                    console.info(`${this.constructor.name} : input = ${input}`)
                    play_incoming_audio_chunks(this.output_ws)
                }
                // Event 'message' on client extension WebSocket
                client.on('message', (message) => {
                    if (message instanceof Buffer) {
                        const uint8Array = new Uint8Array(message)
                        const f32Array = new Float32Array(uint8Array.buffer)

                        // Convert f32Array to s16Array
                        const s16Array = new Int16Array(f32Array.length)
                        for (let i = 0; i < f32Array.length; i++) {
                            s16Array[i] = Math.round(
                                Math.max(
                                    -32768,
                                    Math.min(32767, f32Array[i] * 32768),
                                ),
                            )
                        }
                        // Send audio chunk to output webSocket
                        if (this.output_ws.readyState === WebSocket.OPEN) {
                            this.output_ws.send(s16Array.buffer)
                        }
                    }
                })
                // Event 'close' on client extension WebSocket
                client.on('close', () => {
                    console.log(`${this.constructor.name} : Client has left`)

                    this.output_ws.close()
                })
                // Event 'error' on client extension WebSocket
                client.on('error', (err: Error) => {
                    console.error(
                        `${this.constructor.name} : WebSocket error : ${err}`,
                    )
                })
                // Event 'close' on output WebSocket
                this.output_ws.on('close', () => {
                    console.info(
                        `${this.constructor.name} : Output WebSocket closed`,
                    )
                })
                // Event 'error' on output WebSocket
                this.output_ws.on('error', (err: Error) => {
                    console.error(
                        `${this.constructor.name} : Output WebSocket error : ${err}`,
                    )
                })
            })
        }
        if (input && output !== input) {
            console.info(`${this.constructor.name} : input = ${input}`)
            this.input_ws = new WebSocket(input)
            // Event 'open' on input WebSocket
            this.input_ws.on('open', () => {
                console.info(
                    `${this.constructor.name} : Input WebSocket opened`,
                )
            })
            // Event 'error' on input WebSocket
            this.input_ws.on('error', (err: Error) => {
                console.error(
                    `${this.constructor.name} : Input WebSocket error : ${err}`,
                )
            })
            play_incoming_audio_chunks(this.input_ws)
        }
        Streaming.instance = this
    }

    // Send Speaker Data to Output WebSocket
    public send_speaker_state(speakers: SpeakerData[]) {
        if (this.output_ws?.readyState === WebSocket.OPEN) {
            this.output_ws.send(JSON.stringify(speakers))
        }
    }
}

// Inject audio stream into microphone
const play_incoming_audio_chunks = (input_ws: WebSocket) => {
    new SoundContext(SAMPLE_RATE)
    let stdin = SoundContext.instance.play_stdin()
    let audio_stream = createAudioStreamFromWebSocket(input_ws)
    audio_stream.on('data', (chunk) => {
        // I think that here, in order to prevent the sound from being choppy,
        // it would be necessary to wait a bit (like 4 or 5 chunks) before writing to the stdin.
        stdin.write(chunk) // Write data to stdin
    })
    audio_stream.on('end', () => {
        stdin.end() // Close stdin
    })
}

// Create audio stream filled with incoming data from WebSocket
const createAudioStreamFromWebSocket = (input_ws: WebSocket) => {
    const stream = new Readable({
        read() {},
    })

    input_ws.on('message', (message: RawData) => {
        if (message instanceof Buffer) {
            console.log(`incoming buffer : ${message.byteLength}`)
            const uint8Array = new Uint8Array(message)
            const s16Array = new Int16Array(uint8Array.buffer)

            // Convert s16Array to f32Array
            const f32Array = new Float32Array(s16Array.length)
            for (let i = 0; i < s16Array.length; i++) {
                f32Array[i] = s16Array[i] / 32768
            }

            // Push data into the steam
            const buffer = Buffer.from(f32Array.buffer)
            stream.push(buffer)
        }
    })

    // Event 'close' on input WebSocket
    input_ws.on('close', () => {
        console.info(`Input WebSocket closed`)

        // Indicates End Of Stream
        stream.push(null)
    })
    return stream
}
