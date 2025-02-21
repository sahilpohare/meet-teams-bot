import { Api } from "../api/methods";
import { TranscriptionResult } from "./providers/TranscriptionProvider";
import { TranscriptionSegment } from "./TranscriptionService";

export type RecognizerWord = {
    text: string
    start_time: number
    end_time: number
}

export class WordsPoster {
    private processedSegments: Set<string> = new Set();
    private api: Api;

    constructor(private meetingId: string) {
        this.api = Api.instance;
    }

    public async saveToDatabase(results: TranscriptionResult[], segment: TranscriptionSegment): Promise<void> {
        const segmentKey = `${segment.startTime}-${segment.endTime}`;

        if (this.processedSegments.has(segmentKey)) {
            console.log(`[WordsPoster] Skipping duplicate segment ${segmentKey}`);
            return;
        }

        try {
            this.processedSegments.add(segmentKey);

            const bot = await this.api.getBot();
            
            // Transformer les résultats en format RecognizerWord
            const words: RecognizerWord[] = results.map(result => ({
                text: result.text,
                start_time: result.start_time,
                end_time: result.end_time
            }));

            // Utiliser postWords au lieu de postTranscript
            await this.api.postWords(words, bot.bot.id);

            console.log(`[WordsPoster] Successfully posted words to DB for ${segmentKey}`);
        } catch (error) {
            this.processedSegments.delete(segmentKey);
            console.error(`[WordsPoster] Failed to save to database:`, error);
            throw error;
        }
    }
}
