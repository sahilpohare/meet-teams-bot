export type GetableBot = {
    bot: QueryableBot
    params: any // Unused key/values
    duration: number
}

export type QueryableBot = {
    id: number
    // Unused key/values
}

export type Word = {
    id: number
    text: string
    start_time: number
    end_time: number
    transcript_id: number
}

export type PostableWord = {
    text: string
    start_time: number
    end_time: number
}

export type MeetingProvider = 'Zoom' | 'Meet' | 'Teams'

/** Output word of the `Recognizer`. */
export type RecognizerWord = {
    /** The word recognized. */
    text: string
    /** Start timestamp (in seconds). */
    start_time: number /** End timestamp (in seconds). */
    end_time: number
    /** Confidence ([0.0, 1.0]). */
    confidence: number
}
