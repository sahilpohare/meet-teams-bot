// transcription-state-manager.ts
import { MEETING_CONSTANTS } from '../state-machine/constants'
import { TranscriptionSegment } from './types'

export class TranscriptionStateManager {
    private chunkCount: number = 0
    private readonly chunksPerTranscription: number =
        MEETING_CONSTANTS.CHUNKS_PER_TRANSCRIPTION
    private readonly chunkDuration: number = MEETING_CONSTANTS.CHUNK_DURATION

    public addChunk(timestamp: number): TranscriptionSegment | null {
        // Incrémenter le compteur de chunks
        this.chunkCount++

        // Calculer le vrai timestamp basé sur le numéro du chunk
        const currentTimestamp = (this.chunkCount - 1) * this.chunkDuration

        console.log('Chunk added:', {
            chunkCount: this.chunkCount,
            currentTimestamp,
            duration: this.chunkDuration,
        })

        // Tous les 18 chunks
        if (this.chunkCount % this.chunksPerTranscription === 0) {
            // Le début du segment est 17 chunks en arrière
            const startTime =
                (this.chunkCount - this.chunksPerTranscription) *
                this.chunkDuration
            const endTime = currentTimestamp + this.chunkDuration

            console.log('Creating transcription segment:', {
                chunkCount: this.chunkCount,
                startTime,
                endTime,
                duration: endTime - startTime,
            })

            return {
                id: `${startTime}-${endTime}`,
                startTime,
                endTime,
                status: 'pending',
                retryCount: 0,
            }
        }

        return null
    }

    public finalize(): TranscriptionSegment | null {
        const remainingChunks = this.chunkCount % this.chunksPerTranscription
        if (remainingChunks === 0) return null

        // Calculer les timestamps pour le segment final
        const startTime =
            (this.chunkCount - remainingChunks) * this.chunkDuration
        const endTime = this.chunkCount * this.chunkDuration

        console.log('Finalizing transcription segment:', {
            remainingChunks,
            chunkCount: this.chunkCount,
            startTime,
            endTime,
            duration: endTime - startTime,
        })

        return {
            id: `${startTime}-${endTime}`,
            startTime,
            endTime,
            status: 'pending',
            retryCount: 0,
        }
    }

    public reset(): void {
        this.chunkCount = 0
    }
}
