import { GLOBAL } from '../singleton'
import { MeetingEndReason } from '../state-machine/types'
import { JoinError } from '../types'

interface MeetUrlComponents {
    meetingId: string
    password: string // Empty string for Meet
}

export async function parseMeetingUrlFromJoinInfos(
    meeting_url: string,
): Promise<MeetUrlComponents> {
    let cleanUrl = meeting_url.trim()
    cleanUrl = cleanUrl.replace(/^"(.*)"$/, '$1')

    // Handle URLs starting with just "meet"
    if (cleanUrl.startsWith('meet.')) {
        cleanUrl = `https://${cleanUrl}`
    }

    const urlSplitted = cleanUrl.split(/\s+/)
    const meetCodeRegex =
        /meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})((?:\?.*)?$)/

    try {
        const meetUrl = urlSplitted.find((s) => s.includes('meet.google.com'))
        if (!meetUrl) {
            const error = new JoinError(MeetingEndReason.InvalidMeetingUrl)
            GLOBAL.setError(error)
            throw error
        }

        const match = meetUrl.match(meetCodeRegex)
        if (!match) {
            const error = new JoinError(MeetingEndReason.InvalidMeetingUrl)
            GLOBAL.setError(error)
            throw error
        }

        // Reconstruct the URL in standard format
        const [, meetCode, queryParams = ''] = match
        const standardUrl = `https://meet.google.com/${meetCode}${queryParams}`

        return {
            meetingId: standardUrl,
            password: '',
        }
    } catch (error) {
        const joinError = new JoinError(
            MeetingEndReason.InvalidMeetingUrl,
            `Failed to parse meeting URL: ${error instanceof Error ? error.message : error}`,
            error,
        )
        GLOBAL.setError(joinError)
        throw joinError
    }
}
