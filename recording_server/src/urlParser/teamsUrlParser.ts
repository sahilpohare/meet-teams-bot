import { JoinError, JoinErrorCode } from '../meeting'

export interface TeamsUrlComponents {
    threadId: string
    tenantId?: string
    organizerId?: string
}

export function parseMeetingUrlFromJoinInfos(joinInfo: string): string {
    try {
        const url = new URL(joinInfo)

        if (!url.hostname.includes('teams.microsoft.com')) {
            throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
        }

        const components = parseTeamsUrlComponents(url)

        if (!components?.threadId) {
            throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
        }

        return joinInfo
    } catch (error) {
        // Ne pas utiliser console.error ici
        if (error instanceof JoinError) {
            throw error
        }
        throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
    }
}

function parseTeamsUrlComponents(url: URL): TeamsUrlComponents {
    try {
        const threadMatch = url.pathname.match(
            /19%3ameeting_(.+?)%40thread\.v2/,
        )
        const threadId = threadMatch ? threadMatch[1] : ''

        const params = new URLSearchParams(url.search)
        const context = params.get('context')

        let tenantId = ''
        let organizerId = ''

        if (context) {
            try {
                const contextObj = JSON.parse(decodeURIComponent(context))
                tenantId = contextObj.Tid || ''
                organizerId = contextObj.Oid || ''
            } catch {
                // Ignorer les erreurs de parsing JSON
            }
        }

        return { threadId, tenantId, organizerId }
    } catch {
        return { threadId: '' }
    }
}
