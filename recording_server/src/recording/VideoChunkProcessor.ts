import { queue, QueueObject } from 'async';
import { EventEmitter } from 'events';
import { TranscoderConfig } from './Transcoder';

interface ChunkMetadata {
    index: number;
    timestamp: number;
    duration: number;
    isFinal: boolean;
}

type ChunkTask = () => Promise<void>;

export class VideoChunkProcessor extends EventEmitter {
    private chunkQueue: QueueObject<ChunkTask>;
    private chunkIndex: number = 0;
    private isPaused: boolean = false;
    private pausedChunks: Array<{chunk: Buffer, metadata: ChunkMetadata}> = [];

    constructor(private config: TranscoderConfig) {
        super();
        this.setupQueue();
    }


    public updateConfig(config: TranscoderConfig) {
        this.config = config;
    }

    private setupQueue() {
        this.chunkQueue = queue<ChunkTask>(async (task, callback) => {
            try {
                await task();
                callback();
            } catch (error) {
                callback(error as Error);
            }
        }, 1); // Traiter un chunk à la fois

        this.chunkQueue.drain(() => {
            this.emit('queueDrained');
        });
    }

    public async processChunk(chunk: Buffer, isFinal: boolean = false): Promise<void> {
        const metadata: ChunkMetadata = {
            index: this.chunkIndex++,
            timestamp: Date.now(),
            duration: this.config.chunkDuration,
            isFinal
        };

        if (this.isPaused) {
            this.pausedChunks.push({ chunk, metadata });
            return;
        }

        return new Promise((resolve, reject) => {
            this.chunkQueue.push(async () => {
                try {
                    await this.processChunkInternal(chunk, metadata);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    private async processChunkInternal(chunk: Buffer, metadata: ChunkMetadata): Promise<void> {
        try {
            console.log(`Processing chunk #${metadata.index}, size: ${chunk.length} bytes`);
    
            // Émettre l'événement avec le chunk
            this.emit('chunkReady', {
                chunk,
                metadata,
                timestamp: Date.now()
            });
    
            // Émettre l'événement de chunk traité
            this.emit('chunkProcessed', {
                metadata,
                timestamp: Date.now()
            });
    
        } catch (error) {
            console.error('Error processing chunk:', error);
            this.emit('error', error);
            throw error;
        }
    }

    public async pause(): Promise<void> {
        this.isPaused = true;
        await new Promise<void>(resolve => this.chunkQueue.drain(resolve));
    }

    public async resume(): Promise<void> {
        this.isPaused = false;
        // Traiter les chunks mis en pause
        const chunksToProcess = [...this.pausedChunks];
        this.pausedChunks = [];
        
        for (const { chunk, metadata } of chunksToProcess) {
            await this.processChunk(chunk, metadata.isFinal);
        }
    }

    public async finalize(): Promise<void> {
        // Traiter tous les chunks restants
        if (this.pausedChunks.length > 0) {
            await this.resume();
        }
        await new Promise<void>(resolve => this.chunkQueue.drain(resolve));
    }

    private async writeChunk(chunk: Buffer): Promise<void> {
        try {
            // Émettre l'événement avec le chunk
            this.emit('chunkReady', { chunk, timestamp: Date.now() });
        } catch (error) {
            console.error('Error writing chunk:', error);
            this.emit('error', error);
            throw error;
        }
    }
}