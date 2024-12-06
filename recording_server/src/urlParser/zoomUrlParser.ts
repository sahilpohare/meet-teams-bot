// src/urlParser/zoomUrlParser.ts

import { Browser } from 'puppeteer'
import { JoinError, JoinErrorCode } from '../meeting'

interface ZoomUrlComponents {
    meetingId: string
    password: string
}

export async function parseMeetingUrlFromJoinInfos(
    browser: Browser,
    meeting_url: string,
): Promise<ZoomUrlComponents> {
    if (meeting_url.startsWith('https://www.google.com')) {
        return parseGoogleRedirectUrl(meeting_url)
    }

    try {
        return parseDirectUrl(meeting_url)
    } catch (e) {
        return parseDynamicUrl(browser, meeting_url)
    }
}

async function parseGoogleRedirectUrl(
    meeting_url: string,
): Promise<ZoomUrlComponents> {
    try {
        const url = new URL(meeting_url)
        const params = url.searchParams
        const q = params.get('q')

        if (!q) {
            throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
        }

        return parseZoomComponents(q)
    } catch (e) {
        throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
    }
}

function parseDirectUrl(meeting_url: string): ZoomUrlComponents {
    const components = parseZoomComponents(meeting_url)

    if (!(/^\d+$/.test(components.meetingId) || components.meetingId === '')) {
        throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
    }

    return components
}

async function parseDynamicUrl(
    browser: Browser,
    meeting_url: string,
): Promise<ZoomUrlComponents> {
    let page = null
    try {
        page = await browser.newPage()
        await page.goto(meeting_url, { waitUntil: 'networkidle2' })
        const url = page.url()
        return parseZoomComponents(url)
    } catch (e) {
        throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
    } finally {
        if (page) {
            await page.close().catch(() => {})
        }
    }
}

function parseZoomComponents(url_string: string): ZoomUrlComponents {
    // Gérer les URL de redirection Google
    if (url_string.startsWith('https://www.google.com/url?')) {
        const googleUrl = new URL(url_string)
        url_string = googleUrl.searchParams.get('q') || url_string
    }

    // Séparer l'URL du mot de passe
    const urlPasswordSplit = url_string.split(/(\(Password:|[\s(]Passcode:)/i)
    const urlPart = urlPasswordSplit[0].trim()

    let url: URL
    try {
        url = new URL(urlPart)
    } catch (e) {
        throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
    }

    const params = url.searchParams
    const meetingId = url.pathname.split('/')[2]

    let password = params.get('pwd') || '' // Valeur par défaut vide au lieu de undefined
    if (urlPasswordSplit.length > 1) {
        const passwordPart = urlPasswordSplit.slice(1).join('')
        const passwordMatch = passwordPart.match(
            /(Password|Passcode):\s*(.*?)\)/i,
        )
        if (passwordMatch) {
            password = passwordMatch[2]
        }
    }

    if (!meetingId) {
        throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
    }

    return {
        meetingId,
        password,
    }
}
