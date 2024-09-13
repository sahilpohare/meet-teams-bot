const LOCAL_WEBSOCKET_URL: string = 'ws://localhost:8081'
const FREQUENCY: number = 48_000 // 48khz sample frequency
const BUFFER_SIZE: number = 1024 // Assuming chunks of 7,8125 ms

export class SoundStreamer {
    public static instance: SoundStreamer

    private ws: WebSocket

    constructor() {
        console.info(`${this.constructor.name} : Constructor called`)

        this.ws = new WebSocket(LOCAL_WEBSOCKET_URL)
        this.ws.binaryType = 'arraybuffer'

        this.ws.onopen = (_) => {
            console.log('Websocket opened !')
        }
        this.ws.onclose = (_) => {
            console.log(`Websocket closed !`)
        }
        this.ws.onerror = (evt: Event) => {
            console.error(`Websocket error : ${evt}`)
        }

        SoundStreamer.instance = this
    }

    public start(stream: MediaStream) {
        console.info(`${this.constructor.name} : Starting audio capture`)

        const audioContext = new AudioContext()

        const source = audioContext.createMediaStreamSource(stream)
        const processor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1)

        processor.onaudioprocess = (audioProcessingEvent) => {
            let buffer = audioProcessingEvent.inputBuffer
            const inputData: Float32Array = buffer.getChannelData(0)
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(inputData.buffer)
            }

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

    public stop() {
        console.info(`${this.constructor.name} : Stoping audio capture`)

        this.ws.close()
        // processor.disconnect()
    }
}
