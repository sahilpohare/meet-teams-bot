import { WebSocket } from 'ws'
const fs = require('fs')
const WavEncoder = require('wav-encoder')

const audioData: Float32Array[] = []

export async function websocket() {
    const wss = new WebSocket.Server({ port: 8081 })

    wss.on('connection', (ws: WebSocket) => {
        console.log('Client connecté')

        ws.on('message', (message) => {
            if (message instanceof Buffer) {
                const uint8Array = new Uint8Array(message) // Mandatory : Interprets as a know sized type before converting to f32
                const float32Array = new Float32Array(uint8Array.buffer)
                audioData.push(float32Array)
            }
        })

        ws.on('close', () => {
            console.log('Connexion fermée')
            // const whiteNoise1sec = {
            //     sampleRate: 44100,
            //     channelData: [
            //       new Float32Array(44100).map(() => Math.random() - 0.5),
            //       new Float32Array(44100).map(() => Math.random() - 0.5)
            //     ]
            //   };

            //   WavEncoder.encode(whiteNoise1sec).then((buffer) => {
            //     fs.writeFileSync("noise.wav", new DataView(buffer));
            //   });

            const sampleRate = 44100
            const totalLength = audioData.reduce(
                (sum, arr) => sum + arr.length,
                0,
            )
            const result = new Float32Array(totalLength)

            audioData.reduce((offset, arr) => {
                result.set(arr, offset)
                return offset + arr.length
            }, 0)

            WavEncoder.encode({
                sampleRate,
                channelData: [result],
            }).then((array_buffer) => {
                fs.writeFileSync('output-audio.wav', new DataView(array_buffer))
            })
        })

        wss.on('error', (err: Error) => {
            console.error(`WebSocket error : ${err}`)
        })
    })
}
