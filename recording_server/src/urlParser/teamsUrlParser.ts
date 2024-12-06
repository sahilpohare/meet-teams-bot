import { JoinError, JoinErrorCode } from '../meeting'

export interface TeamsUrlComponents {
    meetingId: string
    password: string
}

export function parseMeetingUrlFromJoinInfos(
    meeting_url: string,
): TeamsUrlComponents {
    try {
        // Handle Google redirect URLs first
        if (meeting_url.startsWith('https://www.google.com/url')) {
            const url = new URL(meeting_url)
            meeting_url = url.searchParams.get('q') || meeting_url
        }

        // For fully encoded URLs, decode once
        if (meeting_url.startsWith('https%3A')) {
            meeting_url = decodeURIComponent(meeting_url)
        }

        const url = new URL(meeting_url)

        // Handle teams.live.com URLs
        if (url.hostname.includes('teams.live.com')) {
            const meetPath = url.pathname.split('/')
            const meetId = meetPath[meetPath.length - 1]
            const params = url.searchParams.toString()

            if (!meetId || meetId === '') {
                throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
            }

            return {
                meetingId: `https://teams.live.com/_#/meet/${meetId}?${params}?anon=true`,
                password: '',
            }
        }

        // Handle teams.microsoft.com URLs
        if (url.hostname.includes('teams.microsoft.com')) {
            // Handle launcher URLs
            if (url.pathname.includes('/dl/launcher/launcher.html')) {
                return {
                    meetingId: meeting_url + '&anon=true',
                    password: '',
                }
            }

            // For standard and TACV2 URLs
            if (
                !meeting_url.includes('thread.v2') &&
                !meeting_url.includes('thread.tacv2')
            ) {
                throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
            }

            return {
                meetingId: meeting_url + '&anon=true',
                password: '',
            }
        }

        throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
    } catch (error) {
        throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
    }
}
