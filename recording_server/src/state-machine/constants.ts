export const MEETING_CONSTANTS = {
    // Durées
    CHUNK_DURATION: 10_000, // 10 secondes pour chaque chunk
    TRANSCRIBE_DURATION: 10_000 * 18, // 3 minutes pour chaque transcription
    
    // Timeouts
    SETUP_TIMEOUT: 30_000, // 30 secondes
    RECORDING_TIMEOUT: 3600 * 4 * 1000, // 4 heures
    NO_SPEAKER_THRESHOLD: 1000 * 60 * 7, // 7 minutes
    NO_SPEAKER_DETECTED_TIMEOUT: 1000 * 60 * 15, // 15 minutes

    // Autres constantes
    FIND_END_MEETING_SLEEP: 250,
    MAX_RETRIES: 3
} as const;