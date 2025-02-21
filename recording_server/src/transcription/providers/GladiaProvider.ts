import fetch from 'node-fetch';
import { BaseTranscriptionProvider, TranscriptionResult } from './TranscriptionProvider';


interface GladiaResponse {
    prediction: {
        transcription: {
            words: Array<{
                word: string;
                start: number;
                end: number;
                confidence: number;
            }>;
        };
    };
}

export class GladiaProvider extends BaseTranscriptionProvider {
    private readonly API_URL = 'https://api.gladia.io/v2/transcription';

    constructor(apiKey: string) {
        super('Gladia', apiKey);
    }

    public async recognize(
        audioUrl: string, 
        vocabulary: string[]
    ): Promise<TranscriptionResult[]> {
        try {
            const response = await fetch(this.API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    audio_url: audioUrl,
                    vocabulary,
                    language_behavior: "automatic single language",
                    target_translation_language: "none",
                    output_format: "json"
                })
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`Gladia API error: ${error}`);
            }

            const data = await response.json() as GladiaResponse;
            return this.parseResponse(data, 0);

        } catch (error) {
            return this.handleApiError(error);
        }
    }

    public parseResponse(response: GladiaResponse, timeOffset: number): TranscriptionResult[] {
        return response.prediction.transcription.words.map(word => ({
            text: word.word,
            start_time: word.start + timeOffset,
            end_time: word.end + timeOffset
        }));
    }
}