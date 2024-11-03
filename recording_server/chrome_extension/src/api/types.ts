export type Word = {
    id: number
    text: string
    start_time: number
    end_time: number
    transcript_id: number
}

export type PostableTranscript = {
    bot_id: number
    speaker: string
    start_time: number
    end_time: number | null
    lang: string | null
}
export type QueryableTranscript = {
    id: number
    bot_id: number
    speaker: string
    start_time: number
    end_time: number | null
    lang: string | null
}

export type ChangeableTranscript = {
    id: number
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
