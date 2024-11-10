const LOCAL_WEBSOCKET_URL: string = 'ws://localhost:8081'
const FREQUENCY: number = 24000 // 24khz sample frequency
const BUFFER_SIZE: number = 256 // Assuming chunks of 62.5 ms

export class SoundStreamer {
    public static instance: SoundStreamer

    private ws: WebSocket
    private processor: ScriptProcessorNode | null = null

    constructor() {
        console.info(this.constructor.name, 'Constructor called')

        this.ws = new WebSocket(LOCAL_WEBSOCKET_URL)
        this.ws.binaryType = 'arraybuffer'

        this.ws.onopen = (_) => {
            console.log('Websocket opened !')
        }
        this.ws.onclose = (_) => {
            console.log('Websocket closed !')
        }
        this.ws.onerror = (evt: Event) => {
            console.error('Websocket error :', evt)
        }

        SoundStreamer.instance = this
    }

    public start(stream: MediaStream) {
        console.info(this.constructor.name, ': Starting audio capture')

        const audioContext = new AudioContext({
            sampleRate: FREQUENCY,
        })

        const source = audioContext.createMediaStreamSource(stream)
        this.processor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1)

        this.processor.onaudioprocess = (audioProcessingEvent) => {
            let buffer = audioProcessingEvent.inputBuffer
            const inputData: Float32Array = buffer.getChannelData(0)
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(inputData.buffer)
            }

            // UNCOMMENT THE FOLLOWING LINES TO REPLAY AUDIO INTO TAB
            // const inputBuffer = audioProcessingEvent.inputBuffer
            // const outputBuffer = audioProcessingEvent.outputBuffer

            // for (let ch = 0; ch < outputBuffer.numberOfChannels; ch++) {
            //     const input = inputBuffer.getChannelData(ch)
            //     const output = outputBuffer.getChannelData(ch)

            //     for (let chunk = 0; chunk < inputBuffer.length; chunk++) {
            //         output[chunk] = input[chunk]
            //     }
            // }
        }
        source.connect(this.processor)
        this.processor.connect(audioContext.destination)
    }

    public stop() {
        console.info(this.constructor.name, ': Stoping audio capture')

        this.ws.close()
        this.processor?.disconnect()
    }
}
