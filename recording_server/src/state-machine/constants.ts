export const MEETING_CONSTANTS = {
    // Durées
    CHUNKS_PER_TRANSCRIPTION: 18,
    CHUNK_DURATION: 10_000, // 10 secondes pour chaque chunk
    // TRANSCRIBE_DURATION: 10_000 * MEETING_CONSTANTS.CHUNKS_PER_TRANSCRIPTION, // 3 minutes pour chaque transcription

    // Timeouts
    SETUP_TIMEOUT: 30_000, // 30 secondes
    RECORDING_TIMEOUT: 3600 * 4 * 1000, // 4 heures
    INITIAL_WAIT_TIME: 1000 * 60 * 7, // 7 minutes
    SILENCE_TIMEOUT: 1000 * 60 * 15, // 15 minutes
    CLEANUP_TIMEOUT: 1000 * 60 * 60, // 1 heure
    RESUMING_TIMEOUT: 1000 * 60 * 60, // 1 heure

    // Autres constantes
    FIND_END_MEETING_SLEEP: 250,
    MAX_RETRIES: 3,
} as const
