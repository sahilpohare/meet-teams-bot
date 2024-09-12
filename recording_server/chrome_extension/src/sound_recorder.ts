const LOCAL_WEBSOCKET_URL: string = 'ws://localhost:8081'
const FREQUENCY: number = 48_000 // 48khz sample frequency
const BUFFER_SIZE: number = 256 // Assuming chunks of 7,8125 ms

export class SoundRecorder {
    public static instance: SoundRecorder

    private ws: WebSocket | null

    constructor() {
        this.ws = null
        SoundRecorder.instance = this
    }

    public start(stream: MediaStream) {
        console.info(`Starting audio capture...`)

        const audioContext = new AudioContext()

        const source = audioContext.createMediaStreamSource(stream)
        const processor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1)

        this.ws = new WebSocket(LOCAL_WEBSOCKET_URL)
        this.ws.binaryType = 'arraybuffer'
        this.ws.onopen = () => {
            console.log('Websocket opened !')
            processor.onaudioprocess = (audioProcessingEvent) => {
                let buffer = audioProcessingEvent.inputBuffer
                const inputData: Float32Array = buffer.getChannelData(0)
                // console.log(inputData[0])
                // console.log(inputData[1])
                // console.log(inputData[2])
                // console.log(inputData[3])
                // if (inputData[0] != 0) {
                this.ws!.send(inputData.buffer)
                // }

                const inputBuffer = audioProcessingEvent.inputBuffer
                const outputBuffer = audioProcessingEvent.outputBuffer

                for (let ch = 0; ch < outputBuffer.numberOfChannels; ch++) {
                    const input = inputBuffer.getChannelData(ch)
                    const output = outputBuffer.getChannelData(ch)

                    for (let chunk = 0; chunk < inputBuffer.length; chunk++) {
                        output[chunk] = input[chunk]
                    }
                }
            }
            source.connect(processor)
            processor.connect(audioContext.destination)
        }

        this.ws.onclose = () => {
            console.log(`Websocket closed !`)
        }
        this.ws.onerror = (evt: Event) => {
            console.error(`Websocket error : ${evt}`)
        }
    }

    public stop() {
        this.ws!.close()
        // processor.disconnect()

        // const tracks = this.stream!.getTracks()
        // tracks.forEach((track) => track.stop())
    }
}
