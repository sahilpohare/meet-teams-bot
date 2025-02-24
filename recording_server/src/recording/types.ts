export interface TranscriptionSegment {
    id: string;
    startTime: number;
    endTime: number;
    audioUrl?: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    retryCount: number;
}