const LOCAL_WEBSOCKET_URL: string = 'ws://localhost:8081'

export class SoundRecorder {
    public static instance: SoundRecorder

    private ws: WebSocket | null

    constructor() {
        this.ws = null
        SoundRecorder.instance = this
    }

    public start(stream: MediaStream) {
        console.info(`Starting audio capture...`)

        //this.audio_context = new AudioContext()

        const audioContext = new AudioContext()

        const source = audioContext.createMediaStreamSource(stream)
        const processor = audioContext.createScriptProcessor(4096, 1, 1)

        source.connect(processor)
        processor.connect(audioContext.destination)

        // Keep playing tab audio
        // this.media_stream_node.connect(this.audio_context.destination)

        this.ws = new WebSocket(LOCAL_WEBSOCKET_URL)
        this.ws.binaryType = 'arraybuffer'
        this.ws.onopen = () => {
            console.log('Websocket opened !')

            // const processor = this.audio_context!.createScriptProcessor(4096, 1, 1)

            // // Connect Audio Stream to Processor
            // this.media_stream_node!.connect(processor)

            // // Keep playing tab audio
            // processor.connect(this.audio_context!.destination)

            // // When data are ready send then to server
            processor.onaudioprocess = (audioProcessingEvent) => {
                let buffer = audioProcessingEvent.inputBuffer
                const inputData: Float32Array = buffer.getChannelData(0)
                console.log(inputData[0])
                console.log(inputData[1])
                console.log(inputData[2])
                console.log(inputData[3])
                this.ws!.send(inputData.buffer)

                const inputBuffer = audioProcessingEvent.inputBuffer
                const outputBuffer = audioProcessingEvent.outputBuffer

                for (
                    let channel = 0;
                    channel < outputBuffer.numberOfChannels;
                    channel++
                ) {
                    const input = inputBuffer.getChannelData(channel)
                    const output = outputBuffer.getChannelData(channel)

                    for (
                        let sample = 0;
                        sample < inputBuffer.length;
                        sample++
                    ) {
                        output[sample] = input[sample]
                    }
                }

                // const audioData =
                //     audioProcessingEvent.inputBuffer.getChannelData(0)

                // // Create buffer with audio data and send them to server
                // this.ws!.send(audioData)
            }
            source.connect(processor)
            processor.connect(audioContext.destination)

            // this.audio_context!.audioWorklet.addModule('processor.js');
            // const processorNode = new AudioWorkletNode(this.audio_context!, 'my-audio-processor');

            // this.media_stream_node = this.audio_context!.createMediaStreamSource(stream)
            // this.media_stream_node.connect(processorNode);

            // processorNode.connect(this.audio_context!.destination);

            // // Écouter les données audio envoyées par le processeur
            // processorNode.port.onmessage = (event) => {
            //     const audioData = event.data;
            //     this.ws!.send(audioData.buffer);
            // }
            // console.log(`audio_context = ${this.audio_context}`)
            processor.disconnect()
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

        // const tracks = this.stream!.getTracks()
        // tracks.forEach((track) => track.stop())
    }
}
