import * as puppeteer from 'puppeteer'
import { Page } from 'puppeteer'
import { sleep } from '../utils'
import { CURRENT_MEETING, MeetingParams } from '../meeting'
import { screenshot } from '../puppeteer'

export async function parseMeetingUrl(
    browser: puppeteer.Browser,
    meeting_url: string,
) {
    // return { meetingId: 'https://teams.live.com/_#/meet/9487829875851?anon=true', password: "" }
    // 'https://teams.live.com/_#/meet/9487829875851&anon=true'
    if (meeting_url.includes('teams.live.com')) {
        // https://teams.live.com/meet/9460778358093
        // https://teams.microsoft.com/l/meetup-join/19%3AA2UA3NRD5KMJxGE2RQvY-IuCJTFV7NzfEWvaYgqiqE41%40thread.tacv2/1648544446696?context=%7B%22Tid%22%3A%2261f3e3b8-9b52-433a-a4eb-c67334ce54d5%22%2C%22Oid%22%3A%22e0bccd79-3e39-43dd-ba50-7b98ab2f8a10%22%7D
        // https://teams.live.com/_#/meet/9487829875851?anon=true&deeplinkId=d6a1aa8d-b724-4e71-be9b-f922da7fd8e7
        const newMeetingId =
            meeting_url.replace('teams.live.com/', 'teams.live.com/_#/') +
            '?anon=true'
        console.log({ newMeetingId })
        return { meetingId: newMeetingId, password: '' }
    } else {
        return {
            meetingId:
                meeting_url.replace(
                    'teams.microsoft.com/',
                    'teams.microsoft.com/_#/',
                ) + '&anon=true',
            password: '',
        }
    }
}

export function getMeetingLink(
    meeting_id: string,
    _password: string,
    _role: number,
    _bot_name: string,
) {
    return meeting_id
}

const url_parse = require('url-parse')
export async function openMeetingPage(
    browser: puppeteer.Browser,
    link: string,
): Promise<puppeteer.Page> {
    const url = url_parse(link, true)
    console.log({ url })

    const context = browser.defaultBrowserContext()
    await context.clearPermissionOverrides()
    await context.overridePermissions(url.origin, ['camera'])

    const page = await browser.newPage()
    await page.goto(link, { waitUntil: 'networkidle2' })
    return page
}

export async function clickWithSelector(
    page: puppeteer.Page,
    selector: string,
    iterations: number,
): Promise<boolean> {
    let i = 0
    let continueButton = false
    while (!continueButton && i < iterations) {
        try {
            continueButton = await page.evaluate(
                (selector, i) => {
                    // Access the window.document object instead of the default document object

                    // Perform your desired operations using the window.document object
                    // For example:
                    var iframes = document.querySelectorAll('iframe')
                    var premierIframe = iframes[0]
                    var documentDansIframe =
                        premierIframe.contentDocument ||
                        premierIframe.contentWindow.document

                    let elements
                    if (i % 2 === 0) {
                        elements = Array.from(
                            documentDansIframe.querySelectorAll(selector),
                        )
                    } else {
                        elements = Array.from(
                            document.querySelectorAll(selector),
                        )
                    }

                    console.log('elements : ', elements)
                    for (const e of elements) {
                        let elem = e as any
                        elem.click()
                        return true
                    }
                    return false
                },
                selector,
                i,
            )
        } catch (e) {
            console.error('failed to find button', e)
        }
        await sleep(1000)
        console.log(
            `element with selector ${selector} clicked:`,
            continueButton,
        )
        i += 1
    }
    return continueButton
}

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
    while (!continueButton && i < iterations) {
        console.log(i)
        try {
            continueButton = await page.evaluate(
                (innerText, htmlType, i, click) => {
                    // Access the window.document object instead of the default document object

                    // Perform your desired operations using the window.document object
                    // For example:
                    var iframes = document.querySelectorAll('iframe')
                    var premierIframe = iframes[0]
                    var documentDansIframe =
                        premierIframe.contentDocument ||
                        premierIframe.contentWindow.document

                    let elements
                    if (i % 2 === 0) {
                        elements = Array.from(
                            documentDansIframe.querySelectorAll(htmlType),
                        )
                    } else {
                        elements = Array.from(
                            document.querySelectorAll(htmlType),
                        )
                    }

                    console.log('elements : ', elements)
                    for (const e of elements) {
                        let elem = e as any
                        console.log(
                            'elem inner text for: ',
                            htmlType,
                            elem.innerText,
                        )
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
        await sleep(1000)
        console.log(`${innerText} clicked:`, continueButton)
        i += 1
    }
    return continueButton
}

export async function joinMeeting(
    page: puppeteer.Page,
    meetingParams: MeetingParams,
): Promise<void> {
    CURRENT_MEETING.logger.info('joining meeting')
    // await sleep(1000000)

    await clickWithInnerText(page, 'button', 'Continue without audio or video')

    //await clickWithInnerText(page, 'a', 'Use the web app instead')
    await sleep(2000)

    // await clickWithInnerText(page, 'button', 'Join now')
    await page.keyboard.type(meetingParams.bot_name)
    console.log(`botname typed`)

    //await clickWithInnerText(page, 'button', 'Join now')
    await clickWithInnerText(page, 'button', 'Join now')

    await screenshot(page, `afterjoinnow`)

    // wait for the view button
    if (!(await clickWithInnerText(page, 'button', 'View', 900, false))) {
        throw 'timeout accepting the bot'
    }
    await sleep(2000)
    // once the view button is found reclick on it
    await clickWithInnerText(page, 'button', 'View', 1)
    await sleep(1000)

    if (!(await clickWithInnerText(page, 'button', 'Speaker', 300))) {
        throw 'timeout accepting the bot'
    }
}

export async function waitForEndMeeting(
    _meetingParams: MeetingParams,
    page: Page,
) {
    CURRENT_MEETING.logger.info('[waitForEndMeeting]')
    let i = 0
    let aloneCount = 0
    while (CURRENT_MEETING && CURRENT_MEETING.status == 'Recording') {
        if (i % 20 === 0) {
            if (await spokeIsAlone(page)) {
                aloneCount++
                if (aloneCount >= 3) {
                    return
                }
            } else {
                aloneCount = 0
            }
        }
        i++
        await sleep(1000)
    }
}

async function spokeIsAlone(page: Page): Promise<boolean> {
    return false
    try {
        const participants = await page.$$('.participantInfo')
        CURRENT_MEETING.logger.info('PARTICIPANTS: ', participants?.length)
        if (participants && participants.length === 1) {
            return true
        }
    } catch (e) {
        CURRENT_MEETING.logger.error(
            `[spokeIsAlone] an error occured in spoke is alone: ${e}`,
        )
    }
    return false
}
