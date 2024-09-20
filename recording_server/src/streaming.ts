import { Server, WebSocket } from 'ws'

import { IncomingMessage } from 'http'
import { SpeakerData } from './types'

const EXTENSION_WEBSOCKET_PORT: number = 8081

export class Streaming {
    public static instance: Streaming | null

    private extension_ws: Server<
        typeof WebSocket,
        typeof IncomingMessage
    > | null
    private output_ws: WebSocket

    constructor(
        _input: string | undefined,
        output: string | undefined,
        bot_id: string,
    ) {
        if (output) {
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
        Streaming.instance = this
    }

    // Send Speaker Data to Output WebSocket
    public send_speaker_state(speakers: SpeakerData[]) {
        if (this.output_ws?.readyState === WebSocket.OPEN) {
            this.output_ws.send(JSON.stringify(speakers))
        }
    }
}

// import { Readable } from 'stream'
// import { SoundContext } from './media_context'
// const fs = require('fs')
// const WavEncoder = require('wav-encoder')

// const audioData: Float32Array[] = []
// const SAMPLE_RATE: number = 48_000
// // TODO : Do something with input
// export async function streaming(input: String | undefined, output: String | undefined) {
//     console.log(input)
//     console.log(output)

//     const wss = new WebSocket.Server({ port: EXTENSION_WEBSOCKET_PORT })
//     new SoundContext(SAMPLE_RATE)
//     let stdin = SoundContext.instance.play_stdin()

//     wss.on('connection', (client: WebSocket) => {
//         console.log('Client connected')

//         let audio_stream = createAudioStreamFromWebSocket(client)
//         audio_stream.on('data', (chunk) => {
//             // I think that here, in order to prevent the sound from being choppy,
//             // it would be necessary to wait a bit (like 4 or 5 chunks) before writing to the stdin.
//             stdin.write(chunk) // Write data to stdin
//         })

//         audio_stream.on('end', () => {
//             stdin.end() // Close stdin
//         })
//     })
// }

// const createAudioStreamFromWebSocket = (ws: WebSocket) => {
//     // Maybe (extension_ws: WebSocket, ai_api_ws: WebSocket) => {
//     const stream = new Readable({
//         read() {},
//     })

//     ws.on('message', (message) => {
//         if (message instanceof Buffer) {
//             const uint8Array = new Uint8Array(message)
//             const float32Array = new Float32Array(uint8Array.buffer)

//             // Push data into the steam
//             const buffer = Buffer.from(float32Array.buffer)
//             stream.push(buffer)

//             // Push into GLOBALE array to generate a final wav file for quality sound check
//             audioData.push(float32Array)
//         }
//     })

//     ws.on('close', () => {
//         console.log('Client has left')

//         // Indicates End Of Stream
//         stream.push(null)

//         // The code below is used to generate a random sound file, basically it's just noise.
//         // const whiteNoise1sec = {
//         //     sampleRate: SAMPLE_RATE,
//         //     channelData: [
//         //         new Float32Array(SAMPLE_RATE).map(() => Math.random() - 0.5),
//         //         new Float32Array(SAMPLE_RATE).map(() => Math.random() - 0.5)
//         //     ]
//         // };

//         // WavEncoder.encode(whiteNoise1sec).then((buffer) => {
//         //     fs.writeFileSync("noise.wav", new DataView(buffer));
//         // });

//         // Retrieve all stored data and generate the wav file.
//         const totalLength = audioData.reduce((sum, arr) => sum + arr.length, 0)
//         const result = new Float32Array(totalLength)

//         audioData.reduce((offset, arr) => {
//             result.set(arr, offset)
//             return offset + arr.length
//         }, 0)

//         const sampleRate = SAMPLE_RATE
//         WavEncoder.encode({
//             sampleRate,
//             channelData: [result],
//         }).then((array_buffer) => {
//             fs.writeFileSync('output-audio.wav', new DataView(array_buffer))
//         })
//     })

//     ws.on('error', (err: Error) => {
//         console.error(`WebSocket error : ${err}`)
//     })
//     return stream
// }
