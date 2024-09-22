export type Word = {
    id: number
    text: string
    start_time: number
    end_time: number
    transcript_id: number
}
export type Transcript = {
    id: number
    speaker: string
    bot_id: number
    start_time: number
    words: Word[]
    lang: string
    end_time: number
}
export type PostableTranscript = {
    speaker: string
    bot_id: number
    start_time: number
    lang: string
    end_time: number
}
export type PostableWord = {
    text: string
    start_time: number
    end_time: number
}

export type MeetingProvider = 'Zoom' | 'Meet' | 'Teams'

/** Output word of the `Recognizer`. */
export type RecognizerWord = {
    /** The type. */
    type: string
    /** The word recognized. */
    value: string
    /** Start timestamp (in seconds). */
    ts: number /** End timestamp (in seconds). */
    end_ts: number
    /** Confidence ([0.0, 1.0]). */
    confidence: number
}

export type RecognizerTranscript = {
    speaker: number
    startTime: number
    endTime: number
    words: RecognizerWord[]
}
