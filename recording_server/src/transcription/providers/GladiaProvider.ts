import axios from 'axios';
import { BaseTranscriptionProvider, TranscriptionError, TranscriptionResult } from './TranscriptionProvider';

// Types pour l'API Gladia
interface TranscribeRequestResponse {
    id: string;
    result_url: string;
}

interface GladiaWord {
    word: string;
    start: number;
    end: number;
    confidence: number;
}

interface GladiaUtterance {
    text: string;
    language: string;
    start: number;
    end: number;
    confidence: number;
    channel: number;
    words: GladiaWord[];
}

interface GladiaTranscription {
    languages: string[];
    utterances: GladiaUtterance[];
    full_transcript: string;
}

interface GladiaResult {
    status: string;
    file: any;
    request_params: any;
    result: {
        transcription: GladiaTranscription;
    };
}

export class GladiaProvider extends BaseTranscriptionProvider {
    private readonly API_URL = 'https://api.gladia.io/v2/transcription';
    private readonly CREATED_HTML_CODE = 201;
    private readonly DONE_HTML_CODE = 200;
    private readonly TRANSCRIPTION_WAIT_TIME = 20000; // 20 secondes

    constructor(apiKey: string) {
        super('Gladia', apiKey);
    }

    public async recognize(audioUrl: string, vocabulary: string[]): Promise<TranscriptionResult[]> {
        try {
            const result = await this.requestTranscription(audioUrl);
            return this.parseResponse(result, 0);
        } catch (error) {
            return this.handleApiError(error);
        }
    }

    private async requestTranscription(audioUrl: string): Promise<GladiaResult> {
        const requestBody = {
            audio_url: audioUrl,
            diarization: false,
            sentences: false,
            subtitles: false,
            enable_code_switching: false,
            detect_language: true,
        };

        try {
            console.log('Requesting Gladia transcription');
            const response = await axios.post(this.API_URL, requestBody, {
                headers: {
                    accept: 'application/json',
                    'x-gladia-key': this.apiKey,
                    'content-type': 'application/json',
                },
            });

            if (response.status !== this.CREATED_HTML_CODE) {
                throw new Error(`Transcription request failed with status ${response.status}`);
            }

            const transcribeResponse = response.data as TranscribeRequestResponse;
            console.log('Gladia response:', transcribeResponse);
            
            return this.pollForResults(transcribeResponse.id);
        } catch (error) {
            throw new TranscriptionError(
                'Failed to start Gladia transcription',
                this.name,
                error
            );
        }
    }

    private async pollForResults(transcriptionId: string): Promise<GladiaResult> {
        let result: GladiaResult;
        
        while (true) {
            await this.sleep(this.TRANSCRIPTION_WAIT_TIME);
            
            try {
                const response = await axios.get(`${this.API_URL}/${transcriptionId}`, {
                    headers: {
                        accept: 'application/json',
                        'x-gladia-key': this.apiKey,
                        'content-type': 'application/json',
                    },
                });

                if (response.status !== this.DONE_HTML_CODE) {
                    throw new Error(`Result retrieval failed with status ${response.status}`);
                }

                result = response.data as GladiaResult;
                
                if (result.status === 'error') {
                    console.error('Error from Gladia:', result);
                    throw new Error('Transcription failed: ' + JSON.stringify(result));
                }
                
                if (result.status === 'done') {
                    break;
                }
                
                console.log('Waiting for Gladia transcription completion');
            } catch (error) {
                throw new TranscriptionError(
                    'Failed to check Gladia transcription status',
                    this.name,
                    error
                );
            }
        }

        return result;
    }

    public parseResponse(response: GladiaResult, timeOffset: number): TranscriptionResult[] {
        console.log('Processing Gladia result');
        
        if (!response?.result?.transcription?.utterances) {
            console.warn('No utterances found in Gladia result');
            return [];
        }

        const words: TranscriptionResult[] = [];
        const utterances = response.result.transcription.utterances;

        for (const utterance of utterances) {
            console.log(`Processing utterance: "${utterance.text}" with ${utterance.words.length} words`);

            for (const word of utterance.words) {
                const cleanWord = word.word.trim();
                if (cleanWord) {
                    // Format identique à RunPodProvider pour compatibilité avec WordsPoster
                    words.push({
                        text: cleanWord,
                        start_time: word.start + timeOffset,
                        end_time: word.end + timeOffset
                    });
                }
            }
        }

        console.log(`Found ${words.length} total words`);
        return words;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}