import { JoinError, JoinErrorCode } from '../meeting'

export interface TeamsUrlComponents {
    meetingId: string
    password: string
}

export function parseMeetingUrlFromJoinInfos(
    meeting_url: string,
): TeamsUrlComponents {
    try {
        if (!meeting_url) {
            throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
        }

        // Handle Google redirect URLs
        if (meeting_url.startsWith('https://www.google.com/url')) {
            const url = new URL(meeting_url)
            meeting_url = url.searchParams.get('q') || meeting_url
        }

        // Decode URL if needed
        if (meeting_url.startsWith('https%3A')) {
            meeting_url = decodeURIComponent(meeting_url)
        }

        const url = new URL(meeting_url)

        // Handle teams.live.com URLs
        if (url.hostname.includes('teams.live.com')) {
            const meetPath = url.pathname.split('/meet/')[1]
            if (!meetPath) {
                throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
            }
            return {
                meetingId: meeting_url,
                password: url.searchParams.get('p') || '',
            }
        }

        // Handle teams.microsoft.com URLs
        if (url.hostname.includes('teams.microsoft.com')) {
            return {
                meetingId:
                    meeting_url +
                    (meeting_url.includes('?') ? '&' : '?') +
                    'anon=true',
                password: '',
            }
        }

        throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
    } catch (error) {
        throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
    }
}
