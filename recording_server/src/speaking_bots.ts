import { WebSocket } from 'ws'
import { SoundContext } from './media_context'
import { Readable } from 'stream'
const fs = require('fs')
const WavEncoder = require('wav-encoder')

//const audioData: Float32Array[] = []
const SAMPLE_RATE: number = 48_000

// const createFloat32Stream = (data: Float32Array): Readable => {
//     const stream = new Readable()
//     stream._read = () => {
//         const buffer = Buffer.from(data.buffer)
//         stream.push(buffer)
//         // stream.push(null) // Signaling end of stream
//     }
//     return stream
// }

const createAudioStreamFromWebSocket = (ws: WebSocket) => {
    const stream = new Readable({
        read() {},
    })

    ws.on('message', (message) => {
        if (message instanceof Buffer) {
            const uint8Array = new Uint8Array(message)
            const float32Array = new Float32Array(uint8Array.buffer)
            const buffer = Buffer.from(float32Array.buffer)

            stream.push(buffer)
        }
    })

    ws.on('close', () => {
        console.log('Client has left')
        stream.push(null)
    })

    ws.on('error', (err: Error) => {
        console.error(`WebSocket error : ${err}`)
    })
    return stream
}

export async function websocket() {
    const wss = new WebSocket.Server({ port: 8081 })
    new SoundContext(SAMPLE_RATE)
    let stdin = SoundContext.instance.play_stdin()

    wss.on('connection', (client: WebSocket) => {
        console.log('Client connected')

        let audio_stream = createAudioStreamFromWebSocket(client)
        audio_stream.on('data', (chunk) => {
            stdin.write(chunk) // Write data to stdin
        })

        audio_stream.on('end', () => {
            stdin.end() // Close stdin
        })

        // client.on('message', (message) => {
        //     if (message instanceof Buffer) {
        //         const uint8Array = new Uint8Array(message) // Mandatory : Interprets as a know sized type before converting to f32
        //         const float32Array = new Float32Array(uint8Array.buffer)
        //         // console.log(float32Array[0])
        //         // console.log(float32Array[1])
        //         // console.log(float32Array[2])
        //         // console.log(float32Array[3])
        //         createFloat32Stream(float32Array).pipe(stdin)
        //         audioData.push(float32Array)
        //     }
        // })

        // client.on('close', () => {
        //     console.log('Client has left')
        //     // const whiteNoise1sec = {
        //     //     sampleRate: SAMPLE_RATE,
        //     //     channelData: [
        //     //       new Float32Array(SAMPLE_RATE).map(() => Math.random() - 0.5),
        //     //       new Float32Array(SAMPLE_RATE).map(() => Math.random() - 0.5)
        //     //     ]
        //     //   };

        //     //   WavEncoder.encode(whiteNoise1sec).then((buffer) => {
        //     //     fs.writeFileSync("noise.wav", new DataView(buffer));
        //     //   });

        //     const totalLength = audioData.reduce(
        //         (sum, arr) => sum + arr.length,
        //         0,
        //     )
        //     const result = new Float32Array(totalLength)

        //     audioData.reduce((offset, arr) => {
        //         result.set(arr, offset)
        //         return offset + arr.length
        //     }, 0)

        //     const sampleRate = SAMPLE_RATE
        //     WavEncoder.encode({
        //         sampleRate,
        //         channelData: [result],
        //     }).then((array_buffer) => {
        //         fs.writeFileSync('output-audio.wav', new DataView(array_buffer))
        //     })
        // })

        // client.on('error', (err: Error) => {
        //     console.error(`WebSocket error : ${err}`)
        // })
    })
}
