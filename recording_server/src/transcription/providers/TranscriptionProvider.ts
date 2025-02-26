// Types de base pour la transcription
export interface TranscriptionResult {
    text: string;
    start_time: number;
    end_time: number;
    confidence?: number;
    speaker?: string;
}

// Interface pour les providers de transcription
export interface TranscriptionProvider {
    name: string;
    recognize(audioUrl: string, vocabulary: string[]): Promise<TranscriptionResult[]>;
    parseResponse(response: any, timeOffset: number): TranscriptionResult[];
}

// Classe de base pour les providers
export abstract class BaseTranscriptionProvider implements TranscriptionProvider {
    constructor(
        public name: string,
        protected apiKey: string
    ) {}

    abstract recognize(audioUrl: string, vocabulary: string[]): Promise<TranscriptionResult[]>;
    abstract parseResponse(response: any, timeOffset: number): TranscriptionResult[];

    protected handleApiError(error: any): never {
        console.error(`${this.name} API Error:`, error);

        let errorMessage = `${this.name} transcription failed`;
        let details = {};

        if (error.response) {
            // Erreur API avec réponse
            errorMessage = `${this.name} API error: ${error.response.status}`;
            try {
                details = {
                    status: error.response.status,
                    data: error.response.data
                };
            } catch (e) {
                details = { error: 'Failed to parse error response' };
            }
        } else if (error.request) {
            // Erreur de réseau
            errorMessage = `${this.name} network error`;
            details = { error: 'Network error', message: error.message };
        } else {
            // Autre type d'erreur
            details = { error: error.message || 'Unknown error' };
        }

        throw new TranscriptionError(errorMessage, this.name, details);
    }

    protected async withTimeout<T>(promise: Promise<T>, timeoutMs: number = 30000, fallback?: T): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                console.warn(`Operation timed out after ${timeoutMs}ms`);
                if (fallback !== undefined) {
                    resolve(fallback);
                } else {
                    reject(new Error(`Operation timed out after ${timeoutMs}ms`));
                }
            }, timeoutMs);

            promise
                .then(result => {
                    clearTimeout(timeoutId);
                    resolve(result);
                })
                .catch(error => {
                    clearTimeout(timeoutId);
                    reject(error);
                });
        });
    }
}

// Classe d'erreur personnalisée pour la transcription
export class TranscriptionError extends Error {
    constructor(
        message: string,
        public provider: string,
        public details?: any
    ) {
        super(message);
        this.name = 'TranscriptionError';
    }
}

// Types pour les options de configuration
export interface TranscriptionOptions {
    language?: string;
    model?: string;
    vocabulary?: string[];
    diarization?: boolean;
    maxDuration?: number;
    timeout?: number;
}

// Interface pour les métadonnées de transcription
export interface TranscriptionMetadata {
    duration: number;
    channelCount: number;
    sampleRate: number;
    format: string;
    provider: string;
    timestamp: number;
}

// Type pour le statut de transcription
export type TranscriptionStatus = 
    | 'pending'
    | 'processing'
    | 'completed'
    | 'failed';

// Interface pour les statistiques de transcription
export interface TranscriptionStats {
    totalSegments: number;
    processedSegments: number;
    failedSegments: number;
    averageProcessingTime: number;
    totalWords: number;
    confidence: number;
}