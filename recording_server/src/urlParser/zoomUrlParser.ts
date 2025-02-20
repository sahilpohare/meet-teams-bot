import { Browser } from '@playwright/test'
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

    // If it's a PMR or a URL with passcode in text, we accept it directly
    if (meeting_url.includes('/my/') || meeting_url.includes('Passcode:')) {
        return components
    }

    // Otherwise, we check that the ID is numeric
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

function extractPasscodeFromText(text: string): string {
    // Handle formats with or without parentheses
    const passcodeMatch = text.match(
        /(?:\()?(?:Passcode|Password):\s*(\d+)(?:\))?/i,
    )
    if (passcodeMatch) {
        return passcodeMatch[1]
    }
    return ''
}

function parseZoomComponents(url_string: string): ZoomUrlComponents {
    // First extract the passcode if it's present in the text
    const passcode = extractPasscodeFromText(url_string)

    // Clean the URL from the passcode text parts
    const cleanUrlMatch = url_string.match(/^(https:\/\/[^(\s]+)/)
    if (!cleanUrlMatch) {
        throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
    }
    const cleanUrl = cleanUrlMatch[1]

    let url: URL
    try {
        url = new URL(cleanUrl)
    } catch (e) {
        throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
    }

    // Handle Personal Meeting Rooms
    if (url.pathname.includes('/my/')) {
        const pmrId = url.pathname.split('/my/')[1]
        return {
            meetingId: pmrId,
            password: passcode,
        }
    }

    // Handle web client URLs
    if (url.pathname.includes('/wc/')) {
        const meetingId = url.pathname.split('/wc/')[1].split('/')[0]
        const password = url.searchParams.get('pwd') || passcode
        return { meetingId, password }
    }

    // Extract the meeting ID by cleaning non-numeric characters
    let meetingId = ''
    if (url.pathname.includes('/j/')) {
        meetingId = url.pathname.split('/j/')[1].split('/')[0]
    } else {
        meetingId = url.pathname.split('/')[2] || ''
    }

    // Clean the meeting ID from non-numeric characters
    meetingId = meetingId.replace(/[^\d]/g, '')

    // Handle the password
    let password = passcode

    // If no passcode found, look in the URL parameters
    if (!password && url.searchParams.has('pwd')) {
        password = decodeURIComponent(url.searchParams.get('pwd') || '')
    }

    // Handle encoded passwords
    if (!password && url_string.includes('pwd%3D')) {
        const pwdMatch = url_string.match(/pwd%3D([^&]+)/)
        if (pwdMatch) {
            password = decodeURIComponent(pwdMatch[1])
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
