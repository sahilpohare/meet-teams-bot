import axios from 'axios';
import { BaseTranscriptionProvider, TranscriptionError, TranscriptionResult } from './TranscriptionProvider';

interface RunPodResult {
    detected_language: string;
    word_timestamps: Array<{
        start: number;
        end: number;
        word: string;
    }>;
}

interface RunPodTranscriptionStatus {
    id: string;
    status: string;
    output?: RunPodResult;
}

export class RunPodProvider extends BaseTranscriptionProvider {
    private readonly API_URL = 'https://api.runpod.ai/v2/oq0i26ut0lom1h';
    private readonly DEFAULT_API_KEY = 'B1EC90VQNXMASRD9QJJAALGOS0YL73JEMKZQ92IJ';
    private readonly POLL_INTERVAL = 5000;
    private readonly DEFAULT_CONFIG = {
        model: 'large-v3',
        transcription: 'plain_text',
        translate: false,
        temperature: 0,
        best_of: 5,
        beam_size: 5,
        patience: 1,
        suppress_tokens: '-1',
        condition_on_previous_text: false,
        temperature_increment_on_fallback: 0.2,
        compression_ratio_threshold: 2.4,
        logprob_threshold: -1,
        no_speech_threshold: 0.6,
        word_timestamps: true
    };

    constructor(apiKey?: string | null) {
        // Si pas d'API key fournie, utiliser celle par défaut
        super('RunPod', apiKey || 'B1EC90VQNXMASRD9QJJAALGOS0YL73JEMKZQ92IJ');
    }

    public async recognize(audioUrl: string, vocabulary: string[]): Promise<TranscriptionResult[]> {
        try {
            const status = await this.startTranscription(audioUrl);
            const result = await this.pollTranscriptionStatus(status.id);
            return this.parseResponse(result, 0);
        } catch (error) {
            return this.handleApiError(error);
        }
    }

    private async startTranscription(audioUrl: string): Promise<RunPodTranscriptionStatus> {
        const requestBody = {
            input: {
                audio: audioUrl,
                ...this.DEFAULT_CONFIG
            },
            enable_vad: false
        };

        try {
            console.log('Starting RunPod transcription');
            const response = await axios.post(
                `${this.API_URL}/run`,
                requestBody,
                {
                    headers: {
                        accept: 'application/json',
                        Authorization: this.apiKey || this.DEFAULT_API_KEY,
                        'content-type': 'application/json'
                    }
                }
            );

            console.log('RunPod transcription started:', response.data);
            return response.data;
        } catch (error) {
            throw new TranscriptionError(
                'Failed to start RunPod transcription',
                this.name,
                error
            );
        }
    }

    private async pollTranscriptionStatus(id: string): Promise<RunPodResult> {
        let attempts = 0;
        const maxAttempts = 60; // 5 minutes maximum (with 5s interval)

        while (attempts < maxAttempts) {
            try {
                const status = await this.checkStatus(id);

                switch (status.status) {
                    case 'COMPLETED':
                        if (!status.output) {
                            throw new Error('Completed status but no output found');
                        }
                        return status.output;

                    case 'FAILED':
                        throw new Error(`Transcription failed: ${JSON.stringify(status)}`);

                    case 'IN_PROGRESS':
                    case 'IN_QUEUE':
                        console.log(`Transcription status: ${status.status}`);
                        await this.sleep(this.POLL_INTERVAL);
                        attempts++;
                        break;

                    default:
                        throw new Error(`Unknown status: ${status.status}`);
                }
            } catch (error) {
                if (attempts >= maxAttempts - 1) {
                    throw error;
                }
                console.warn(`Error checking status (attempt ${attempts + 1}):`, error);
                await this.sleep(this.POLL_INTERVAL);
                attempts++;
            }
        }

        throw new Error('Transcription timeout');
    }

    private async checkStatus(id: string): Promise<RunPodTranscriptionStatus> {
        try {
            const response = await axios.get(
                `${this.API_URL}/status/${id}`,
                {
                    headers: {
                        accept: 'application/json',
                        Authorization: this.apiKey || this.DEFAULT_API_KEY,
                        'content-type': 'application/json'
                    }
                }
            );

            console.log('RunPod status check:', response.data);
            return response.data;
        } catch (error) {
            throw new TranscriptionError(
                'Failed to check RunPod status',
                this.name,
                error
            );
        }
    }

    public parseResponse(response: RunPodResult, timeOffset: number): TranscriptionResult[] {
        return response.word_timestamps.map(word => ({
            text: word.word.trim(),
            start_time: word.start + timeOffset,
            end_time: word.end + timeOffset
        }));
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}