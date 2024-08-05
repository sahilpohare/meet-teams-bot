import * as puppeteer from 'puppeteer'

import {
    CancellationToken,
    MeetingParams,
    MeetingProviderInterface,
} from '../types'
import { JoinError, JoinErrorCode } from '../meeting'

import { Page } from 'puppeteer'
import { URL } from 'url'
import { sleep } from '../utils'

export class ZoomProvider implements MeetingProviderInterface {
    constructor() {}
    async parseMeetingUrl(browser: puppeteer.Browser, meeting_url: string) {
        if (meeting_url.startsWith('https://www.google.com')) {
            try {
                const url = new URL(meeting_url)
                const params = url.searchParams
                const q = params.get('q')

                console.log({ q })
                const { meetingId, password } = parse(q)
                return { meetingId, password }
            } catch (e) {
                console.error('[parseMeetingUrl] parse meeting url', e)
                throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
            }
        }
        try {
            try {
                const { meetingId, password } = parse(meeting_url)
                if (!(/^\d+$/.test(meetingId) || meetingId === '')) {
                    throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
                }
                return { meetingId, password }
            } catch (e) {
                console.error('error requesting meeting url')
                try {
                    const page = await browser.newPage()
                    console.log('goto: ', meeting_url)
                    await page.goto(meeting_url, { waitUntil: 'networkidle2' })
                    const url = page.url()
                    console.log({ url })
                    const { meetingId, password } = parse(url)

                    try {
                        await page.close()
                    } catch (e) {}
                    return { meetingId, password }
                    // https://ghlsuccess.com/zoom
                } catch (e) {
                    console.error('error goto page: ', e)
                    throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
                }
            }
        } catch (e) {
            console.error('[parseMeetingUrl] invalid meeting url', e)
            throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
        }
    }
    getMeetingLink(
        meeting_id: string,
        password: string,
        role: number,
        bot_name: string,
    ) {
        return `${MEETINGJS_BASEURL}?meeting_id=${meeting_id}&password=${password}&role=${role}&name=${bot_name}`
    }
    async openMeetingPage(
        browser: puppeteer.Browser,
        link: string,
    ): Promise<puppeteer.Page> {
        const url = new URL(link)
        console.log({ url })
        const context = browser.defaultBrowserContext()
        await context.clearPermissionOverrides()
        await context.overridePermissions(url.origin, ['camera'])
        const page = await browser.newPage()
        await page.goto(link, { waitUntil: 'networkidle2' })
        return page
    }

    async joinMeeting(
        page: puppeteer.Page,
        cancelCheck: () => boolean,
        meetingParams: MeetingParams,
    ): Promise<void> {
        await sleep(1000)
    }

    async findEndMeeting(
        meetingParams: MeetingParams,
        page: Page,
        cancellationToken: CancellationToken,
    ): Promise<boolean> {
        //TODO COMUNICATE WITH THE SERVER TO FIND THE END MEETING BUTTON
        return false
    }
}

function parse(meeting_url: string) {
    const urlSplited = meeting_url.split(' ')[0]
    const url = new URL(urlSplited)
    const params = url.searchParams
    const meetingId = url.pathname.split('/')[2]

    let password = params.get('pwd')
    if (password == null) {
        try {
            const array = [...meeting_url.matchAll(/: (.*)\)/g)]
            password = array[0][1]
        } catch (e) {}
    }

    if (meetingId == null) {
        throw 'invalid meeting url'
    }
    console.log('ZOOM PARSING MeetingId and password', { meetingId, password })
    return { meetingId, password }
}

const MEETINGJS_BASEURL = `http://localhost:3005`

// async function sendEnterMessage(page: puppeteer.Page, message: string) {}

export async function clickWithInnerText(
    page: puppeteer.Page,
    htmlType: string,
    innerText: string,
    iterations?: number,
    click: boolean = true,
): Promise<boolean> {
    let i = 0
    iterations = iterations ?? 10
    let continueButton = false

    while (!continueButton && (iterations == null || i < iterations)) {
        try {
            continueButton = await page.evaluate(
                (innerText, htmlType, i, click) => {
                    const elements = Array.from(
                        document.querySelectorAll(htmlType),
                    )
                    for (const e of elements) {
                        let elem = e as any
                        if (elem.innerText === innerText) {
                            if (click) {
                                elem.click()
                            }
                            return true
                        }
                    }
                    return false
                },
                innerText,
                htmlType,
                i,
                click,
            )
        } catch (e) {
            console.error('failed to find button', e)
        }
        await sleep(500)
        console.log(`${innerText} clicked:`, continueButton)
        i += 1
    }
    return continueButton
}
