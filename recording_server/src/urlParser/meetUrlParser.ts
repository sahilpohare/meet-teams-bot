import { JoinError, JoinErrorCode } from '../meeting'

export interface MeetUrlComponents {
    meetingId: string
    password: string // Empty string for Meet
}

export async function parseMeetingUrlFromJoinInfos(
    meeting_url: string,
): Promise<MeetUrlComponents> {
    if (meeting_url.startsWith('meet')) {
        meeting_url = `https://${meeting_url}`
    }

    const urlSplitted = meeting_url.split(/\s+/)
    const strictRegex =
        /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(\?.*)?$/

    try {
        const meetUrl = urlSplitted.find((s) => s.startsWith('https://meet'))
        if (!meetUrl || !strictRegex.test(meetUrl)) {
            throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
        }

        return {
            meetingId: meetUrl,
            password: '', // Meet doesn't use a password
        }
    } catch (error) {
        throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
    }
}

export function isMeetUrl(url: string): boolean {
    return url.includes('meet.google.com')
}

export function extractMeetCode(url: string): string | null {
    const match = url.match(/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/)
    return match ? match[1] : null
}
