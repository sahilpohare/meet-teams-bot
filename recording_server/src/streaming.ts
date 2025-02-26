import { IncomingMessage } from 'http'
import { Readable } from 'stream'
import { RawData, Server, WebSocket } from 'ws'

import { SoundContext } from './media_context'
import { JoinErrorCode, SpeakerData } from './types'


const EXTENSION_WEBSOCKET_PORT: number = 8081
const DEFAULT_SAMPLE_RATE: number = 24_000
export class Streaming {
    public static instance: Streaming | null

    private extension_ws: Server<
        typeof WebSocket,
        typeof IncomingMessage
    > | null
    private output_ws: WebSocket | null = null // May be used as dual channel, input and output
    private input_ws: WebSocket | null = null
    private sample_rate: number = DEFAULT_SAMPLE_RATE

    constructor(
        input: string | undefined,
        output: string | undefined,
        sample_rate: number | undefined,
        bot_id: string,
    ) {
        if (sample_rate) {
            this.sample_rate = sample_rate
        }
        
        try {
            if (output) {
                console.log(`output = ${output}`)
                try {
                    this.extension_ws = new WebSocket.Server({
                        port: EXTENSION_WEBSOCKET_PORT,
                    });
                } catch (error) {
                    throw new Error(`Failed to create WebSocket server on port ${EXTENSION_WEBSOCKET_PORT}: ${error as Error}.message`);
                }

                // Event 'connection' on client extension WebSocket
                this.extension_ws.on('connection', (client: WebSocket) => {
                    console.log(`Client connected`)

                    try {
                        this.output_ws = new WebSocket(output)
                    } catch (error) {
                        throw new Error(`Failed to connect to output WebSocket at ${output}: ${error as Error}.message`);
                    }
                    
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
                        console.log(`input = ${input}`)
                        this.play_incoming_audio_chunks(this.output_ws)
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
                        console.log(`Client has left`)

                        this.output_ws.close()
                    })
                    // Event 'error' on client extension WebSocket
                    client.on('error', (err: Error) => {
                        console.error(`WebSocket error : ${err}`)
                    })
                    // Event 'close' on output WebSocket
                    this.output_ws.on('close', () => {
                        console.log(`Output WebSocket closed`)
                    })
                    // Event 'error' on output WebSocket
                    this.output_ws.on('error', (err: Error) => {
                        console.error(`Output WebSocket error : ${err}`)
                    })
                })
            }
            
            if (input && output !== input) {
                console.log(`input = ${input}`)
                try {
                    this.input_ws = new WebSocket(input)
                } catch (error) {
                    throw new Error(`Failed to connect to input WebSocket at ${input}: ${error as Error}.message`);
                }
                // Event 'open' on input WebSocket
                this.input_ws.on('open', () => {
                    console.log(`Input WebSocket opened`)
                })
                // Event 'error' on input WebSocket
                this.input_ws.on('error', (err: Error) => {
                    console.error(`Input WebSocket error : ${err}`)
                })
                this.play_incoming_audio_chunks(this.input_ws)
            }
            
            Streaming.instance = this
        } catch (error) {
            console.error(`Streaming setup failed: ${error as Error}.message`);
            throw {
                code: JoinErrorCode.StreamingSetupFailed,
                message: `Failed to setup streaming: ${error as Error}.message`
            };
        }
    }

    // Send Speaker Data to Output WebSocket
    public send_speaker_state(speakers: SpeakerData[]) {
        if (this.output_ws?.readyState === WebSocket.OPEN) {
            this.output_ws.send(JSON.stringify(speakers))
        }
    }
    // Inject audio stream into microphone
    private play_incoming_audio_chunks = (input_ws: WebSocket) => {
        new SoundContext(this.sample_rate)
        let stdin = SoundContext.instance.play_stdin()
        let audio_stream = this.createAudioStreamFromWebSocket(input_ws)
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
    private createAudioStreamFromWebSocket = (input_ws: WebSocket) => {
        const stream = new Readable({
            read() {},
        })
        let hasLoggedError = false
        input_ws.on('message', (message: RawData) => {
            if (message instanceof Buffer) {
                const uint8Array = new Uint8Array(message)
                try {
                    const s16Array = new Int16Array(uint8Array.buffer)
                    // Convert s16Array to f32Array
                    const f32Array = new Float32Array(s16Array.length)
                    for (let i = 0; i < s16Array.length; i++) {
                        f32Array[i] = s16Array[i] / 32768
                    }
                    // Push data into the steam
                    const buffer = Buffer.from(f32Array.buffer)
                    stream.push(buffer)
                } catch (error) {
                    if (!hasLoggedError) {
                        console.error(
                            `Error processing audio chunk: Buffer length ${uint8Array.length} is not valid for Int16Array conversion`,
                        )
                        hasLoggedError = true
                    }
                }
            }
        })

        // Event 'close' on input WebSocket
        input_ws.on('close', () => {
            console.log(`Input WebSocket closed`)

            // Indicates End Of Stream
            stream.push(null)
        })
        return stream
    }
}
