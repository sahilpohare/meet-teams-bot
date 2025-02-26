import { JoinError, JoinErrorCode } from '../types'

export interface TeamsUrlComponents {
    meetingId: string
    password: string
}

// function convertLightMeetingToStandard(url: URL): string {
//     const coords = url.searchParams.get('coords')
//     if (!coords) {
//         throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
//     }

//     try {
//         const decodedCoords = JSON.parse(decodeURIComponent(atob(coords)))
//         const { conversationId, tenantId, messageId, organizerId } = decodedCoords
//         if (!conversationId || !tenantId || !messageId) {
//             throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
//         }

//         // Construct context with all original parameters
//         const context = {
//             Tid: tenantId,
//             ...(organizerId ? { Oid: organizerId } : {})
//         }

//         // Construct URL exactly matching the original format
//         const standardUrl = `https://teams.microsoft.com/l/meetup-join/${conversationId}/${messageId}?context=${encodeURIComponent(JSON.stringify(context))}`
//         console.log('🥕🥕🥕 Converting light meeting to standard URL:', standardUrl)
//         return standardUrl
//     } catch (e) {
//         console.error('🥕❌ Error converting light meeting URL:', e)
//         throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
//     }
// }

// function convertStandardToLightMeeting(url: URL): string {
//     try {
//         // Extract components from standard URL
//         const pathParts = url.pathname.split('/')
//         const conversationId = pathParts[pathParts.length - 2]
//         const messageId = pathParts[pathParts.length - 1]
        
//         // Extract tenant ID from context
//         const contextParam = url.searchParams.get('context')
//         if (!contextParam) {
//             throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
//         }
//         const context = JSON.parse(decodeURIComponent(contextParam))
//         const tenantId = context.Tid
//         const organizerId = context.Oid || ''

//         // Create coords data exactly matching Teams format
//         const coordsData = {
//             conversationId,
//             tenantId,
//             organizerId,
//             messageId
//         }

//         // Encode coords
//         const coords = btoa(JSON.stringify(coordsData))

//         // Construct light meetings URL with version
//         const lightUrl = `https://teams.microsoft.com/light-meetings/launch?agent=web&version=25013018700&coords=${encodeURIComponent(coords)}`
//         console.log('🥕➡️ Converting standard to light meeting URL:', lightUrl)
//         return lightUrl
//     } catch (e) {
//         console.error('🥕❌ Error converting to light meeting URL:', e)
//         throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
//     }
// }

export function parseMeetingUrlFromJoinInfos(
    meeting_url: string,
): TeamsUrlComponents {
    try {
        if (!meeting_url) {
            throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
        }

        console.log('Parsing meeting URL:', meeting_url)

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
            // Keep the URL exactly as is, just add anon=true
            const joinUrl = meeting_url + 
                (meeting_url.includes('?') ? '&' : '?') + 
                'anon=true'
            console.log('Using standard Teams URL:', joinUrl)
            return {
                meetingId: joinUrl,
                password: '',
            }
        }

        throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
    } catch (error) {
        throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
    }
}

// // Export for testing
// export const __testing = {
//     convertLightMeetingToStandard,
//     convertStandardToLightMeeting
// }
