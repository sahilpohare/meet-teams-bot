import { IncomingMessage } from 'http'
import { Readable, Writable } from 'stream'
import { RawData, Server, WebSocket } from 'ws'

import { SoundContext } from './media_context'
import { JoinErrorCode, SpeakerData } from './types'

const EXTENSION_WEBSOCKET_PORT: number = 8081
const DEFAULT_SAMPLE_RATE: number = 24_000

export class Streaming {
    public static instance: Streaming | null = null

    private extension_ws: Server<
        typeof WebSocket,
        typeof IncomingMessage
    > | null = null
    private output_ws: WebSocket | null = null // May be used as dual channel, input and output
    private input_ws: WebSocket | null = null
    private sample_rate: number = DEFAULT_SAMPLE_RATE
    private stdinStream: Writable | null = null
    
    // Paramètres stockés pour démarrage différé
    private inputUrl: string | undefined
    private outputUrl: string | undefined
    private botId: string
    
    // État du streaming
    private isInitialized: boolean = false
    private isPaused: boolean = false
    private pausedChunks: RawData[] = []

    constructor(
        input: string | undefined,
        output: string | undefined,
        sample_rate: number | undefined,
        bot_id: string,
    ) {
        console.log('Streaming service initialized with params:', {
            input,
            output,
            sample_rate,
            bot_id
        });
        
        // Stocker les paramètres pour une utilisation ultérieure
        this.inputUrl = input;
        this.outputUrl = output;
        this.botId = bot_id;
        
        if (sample_rate) {
            this.sample_rate = sample_rate
        }
        
        // Ne pas démarrer immédiatement, attendre l'appel à start()
        Streaming.instance = this;
    }

    /**
     * Démarre le service de streaming
     */
    public start(): void {
        if (this.isInitialized) {
            console.warn('Streaming service already started');
            return;
        }
        
        console.log('Starting streaming service');
        
        try {
            if (this.outputUrl) {
                console.log(`output = ${this.outputUrl}`)
                try {
                    this.extension_ws = new WebSocket.Server({
                        port: EXTENSION_WEBSOCKET_PORT,
                    });
                } catch (error) {
                    throw new Error(`Failed to create WebSocket server on port ${EXTENSION_WEBSOCKET_PORT}: ${(error as Error).message}`);
                }

                // Event 'connection' on client extension WebSocket
                this.extension_ws.on('connection', (client: WebSocket) => {
                    console.log(`Client connected`)

                    try {
                        this.output_ws = new WebSocket(this.outputUrl)
                    } catch (error) {
                        throw new Error(`Failed to connect to output WebSocket at ${this.outputUrl}: ${(error as Error).message}`);
                    }
                    
                    // Send initial message to output webSocket
                    this.output_ws.on('open', () => {
                        this.output_ws.send(
                            JSON.stringify({
                                protocol_version: 1,
                                bot_id: this.botId,
                                offset: 0.0,
                            }),
                        )
                    })
                    // Dual channel
                    if (this.inputUrl === this.outputUrl) {
                        console.log(`input = ${this.inputUrl}`)
                        this.play_incoming_audio_chunks(this.output_ws)
                    }
                    // Event 'message' on client extension WebSocket
                    client.on('message', (message) => {
                        if (this.isPaused) {
                            // Si en pause, stocker les chunks pour traitement ultérieur
                            this.pausedChunks.push(message);
                            return;
                        }
                        
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
            
            if (this.inputUrl && this.outputUrl !== this.inputUrl) {
                console.log(`input = ${this.inputUrl}`)
                try {
                    this.input_ws = new WebSocket(this.inputUrl)
                } catch (error) {
                    throw new Error(`Failed to connect to input WebSocket at ${this.inputUrl}: ${(error as Error).message}`);
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
            
            this.isInitialized = true;
            this.isPaused = false;
            
        } catch (error) {
            console.error(`Streaming setup failed: ${(error as Error).message}`);
            throw {
                code: JoinErrorCode.StreamingSetupFailed,
                message: `Failed to setup streaming: ${(error as Error).message}`
            };
        }
    }
    
    /**
     * Met en pause le service de streaming
     */
    public pause(): void {
        if (!this.isInitialized) {
            console.warn('Cannot pause: streaming service not started');
            return;
        }
        
        if (this.isPaused) {
            console.warn('Streaming service already paused');
            return;
        }
        
        console.log('Pausing streaming service');
        this.isPaused = true;
    }
    
    /**
     * Reprend le service de streaming après une pause
     */
    public resume(): void {
        if (!this.isInitialized) {
            console.warn('Cannot resume: streaming service not started');
            return;
        }
        
        if (!this.isPaused) {
            console.warn('Streaming service not paused');
            return;
        }
        
        console.log('Resuming streaming service');
        this.isPaused = false;
        
        // Traiter les chunks mis en pause
        this.processPausedChunks();
    }
    
    /**
     * Arrête complètement le service de streaming
     */
    public stop(): void {
        if (!this.isInitialized) {
            console.warn('Cannot stop: streaming service not started');
            return;
        }
        
        console.log('Stopping streaming service');
        
        // Fermer le flux stdin s'il existe
        if (this.stdinStream) {
            try {
                this.stdinStream.end();
            } catch (error) {
                console.error('Error closing stdin stream:', error);
            }
            this.stdinStream = null;
        }
        
        // Fermer les connexions WebSocket
        if (this.extension_ws) {
            this.extension_ws.close();
            this.extension_ws = null;
        }
        
        if (this.output_ws) {
            this.output_ws.close();
            this.output_ws = null;
        }
        
        if (this.input_ws) {
            this.input_ws.close();
            this.input_ws = null;
        }
        
        // Réinitialiser l'état
        this.isInitialized = false;
        this.isPaused = false;
        this.pausedChunks = [];
        
        // Réinitialiser l'instance statique
        Streaming.instance = null;
    }

    // Send Speaker Data to Output WebSocket
    public send_speaker_state(speakers: SpeakerData[]) {
        if (!this.isInitialized) {
            return;
        }
        
        if (this.isPaused) {
            // On pourrait stocker les états des speakers pendant la pause
            return;
        }
        
        if (this.output_ws?.readyState === WebSocket.OPEN) {
            this.output_ws.send(JSON.stringify(speakers))
        }
    }
    
    /**
     * Traite les chunks audio mis en pause
     */
    private processPausedChunks(): void {
        if (this.pausedChunks.length === 0) {
            return;
        }
        
        console.log(`Processing ${this.pausedChunks.length} paused chunks`);
        
        // Traiter les chunks stockés pendant la pause
        for (const message of this.pausedChunks) {
            // Réutiliser la logique de traitement des messages
            if (this.output_ws && message instanceof Buffer) {
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
        }
        
        // Vider le tableau des chunks en pause
        this.pausedChunks = [];
    }
    
    // Inject audio stream into microphone
    private play_incoming_audio_chunks = (input_ws: WebSocket) => {
        new SoundContext(this.sample_rate)
        this.stdinStream = SoundContext.instance.play_stdin()
        let audio_stream = this.createAudioStreamFromWebSocket(input_ws)
        audio_stream.on('data', (chunk) => {
            // Si en pause, ne pas traiter les chunks audio
            if (this.isPaused) {
                return;
            }
            
            // I think that here, in order to prevent the sound from being choppy,
            // it would be necessary to wait a bit (like 4 or 5 chunks) before writing to the stdin.
            if (this.stdinStream && this.stdinStream.writable) {
                this.stdinStream.write(chunk) // Write data to stdin
            }
        })
        audio_stream.on('end', () => {
            if (this.stdinStream) {
                this.stdinStream.end() // Close stdin
            }
        })
    }

    // Create audio stream filled with incoming data from WebSocket
    private createAudioStreamFromWebSocket = (input_ws: WebSocket) => {
        const stream = new Readable({
            read() {},
        })
        let hasLoggedError = false
        input_ws.on('message', (message: RawData) => {
            // Si en pause, ne pas traiter les messages
            if (this.isPaused) {
                return;
            }
            
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
