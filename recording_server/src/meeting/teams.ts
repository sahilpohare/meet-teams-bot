import * as jsdom from 'jsdom'
import * as puppeteer from 'puppeteer'

import {
    CancellationToken,
    MeetingParams,
    MeetingProviderInterface,
} from '../types'

import { Page } from 'puppeteer'
import { screenshot } from '../puppeteer'
import { sleep } from '../utils'

export class TeamsProvider implements MeetingProviderInterface {
    constructor() {}
    getMeetingLink(
        meeting_id: string,
        _password: string,
        _role: number,
        _bot_name: string,
    ) {
        return meeting_id
    }
    async parseMeetingUrl(browser: puppeteer.Browser, meeting_url: string) {
        // return { meetingId: 'https://teams.live.com/_#/meet/9487829875851?anon=true', password: "" }
        // 'https://teams.live.com/_#/meet/9487829875851&anon=true'

        let newMeetingUrl = meeting_url
        try {
            newMeetingUrl = parseMeetingUrlFromJoinInfos(meeting_url)
        } catch (e) {
            console.error(
                'failed to parse meeting url from join info, trying another method',
                e,
            )
        }

        if (newMeetingUrl.includes('teams.live.com')) {
            // https://teams.live.com/meet/9460778358093
            // https://teams.microsoft.com/l/meetup-join/19%3AA2UA3NRD5KMJxGE2RQvY-IuCJTFV7NzfEWvaYgqiqE41%40thread.tacv2/1648544446696?context=%7B%22Tid%22%3A%2261f3e3b8-9b52-433a-a4eb-c67334ce54d5%22%2C%22Oid%22%3A%22e0bccd79-3e39-43dd-ba50-7b98ab2f8a10%22%7D
            // https://teams.live.com/_#/meet/9487829875851?anon=true&deeplinkId=d6a1aa8d-b724-4e71-be9b-f922da7fd8e7
            const newMeetingId =
                newMeetingUrl.replace('teams.live.com/', 'teams.live.com/_#/') +
                '?anon=true'
            console.log({ newMeetingId })
            return { meetingId: newMeetingId, password: '' }
        } else {
            return {
                meetingId:
                    newMeetingUrl.replace(
                        'teams.microsoft.com/',
                        'teams.microsoft.com/',
                    ) + '&anon=true',
                password: '',
            }
        }
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
        cancellationToken: CancellationToken,
        meetingParams: MeetingParams,
    ): Promise<void> {
        console.log('joining meeting')

        await clickWithInnerText(page, 'button', 'Continue on this browser', 20)

        await clickWithInnerText(
            page,
            'button',
            'Continue without audio or video',
            20,
        )
        await typeBotName(page, meetingParams.bot_name, 20)
        await clickWithInnerText(page, 'button', 'Join now', 20)
        await screenshot(page, `afterjoinnow`)

        // wait for the view button

        if (
            !(await clickWithInnerText(
                page,
                'button',
                'View',
                6000,
                false,
                cancellationToken,
            ))
        ) {
            throw 'timeout accepting the bot'
        }
        await sleep(2000)
        // once the view button is found reclick on it
        await clickWithInnerText(page, 'button', 'View', 10)

        await clickWithInnerText(page, 'div', 'Speaker', 20)
    }

    async findEndMeeting(
        _meetingParams: MeetingParams,
        page: Page,
        cancellationToken: CancellationToken,
    ): Promise<boolean> {
        if ((await spokeIsAlone(page)) === false) {
            cancellationToken.reset()
        } else if (cancellationToken.isCancellationRequested === true) {
            return true
        }
        return false
    }
}

async function typeBotName(page: puppeteer.Page, botName: string, iterations: number) {
    let botnameTyped = null
    for (let i = 0; i < iterations; i++) {
        try {
            await focusInput(INPUT_BOT, page, 2)
            await page.keyboard.type(botName, { delay: 100 })
            botnameTyped = await getInput(INPUT_BOT, page, 2)
            if (botnameTyped != null && botnameTyped != '') {
                console.log(`botname typed`)
                return 
            }
        } catch (e) {
            console.error('failed to type bot name', e)
        }
    }
}
function parseMeetingUrlFromJoinInfos(joinInfo: string) {
    // Parse the HTML string with jsdom
    const { JSDOM } = jsdom
    const dom = new JSDOM(joinInfo)

    // Use the document object as you would in a browser
    const document = dom.window.document
    const meetingLinkTag = document.querySelector(
        'a[href*="teams.live.com/meet"]',
    )

    // Extract the href attribute, which is the meeting URL
    const meetingUrl = meetingLinkTag
        ? meetingLinkTag.getAttribute('href')
        : null

    if (meetingUrl == null) {
        throw 'failed to parse meeting url from join info'
    }
    return meetingUrl
}

export async function innerTextWithSelector(
    page: puppeteer.Page,
    selector: string,
    message: string,
    iterations: number,
): Promise<boolean> {
    let i = 0
    let continueButton = false
    while (!continueButton && i < iterations) {
        try {
            continueButton = await page.evaluate(
                (selector, i, message) => {
                    let elements
                    if (i % 2 === 0) {
                        const iframe = document.querySelectorAll('iframe')[0]
                        const iframeDocument =
                            iframe.contentDocument ||
                            iframe.contentWindow.document

                        elements = Array.from(
                            iframeDocument.querySelectorAll(selector),
                        )
                    } else {
                        elements = Array.from(
                            document.querySelectorAll(selector),
                        )
                    }

                    for (const e of elements) {
                        let elem = e as any
                        elem.innerText = message
                        return true
                    }
                    return false
                },
                selector,
                i,
                message,
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

                    let elements
                    if (i % 2 === 0) {
                        var documentDansIframe =
                            premierIframe.contentDocument ||
                            premierIframe.contentWindow.document
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
    iterations: number,
    click: boolean = true,
    cancellationToken?: CancellationToken,
): Promise<boolean> {
    let i = 0
    iterations = iterations
    let continueButton = false

    while (
        !continueButton &&
        (iterations == null || i < iterations) &&
        cancellationToken?.isCancellationRequested !== true
    ) {
        try {
            continueButton = await page.evaluate(
                (innerText, htmlType, i, click) => {
                    let elements

                    var iframes = document.querySelectorAll('iframe')
                    console.log('iframes : ', iframes)
                    if (i % 2 === 0) {
                        var premierIframe = iframes[0]
                        var documentDansIframe =
                            premierIframe.contentDocument ||
                            premierIframe.contentWindow.document
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
    console.log('cancellationToken', cancellationToken)
    return continueButton
}


const INPUT_BOT = 'input[placeholder="Type your name"]'
async function focusInput(input: string, page: puppeteer.Page, iterations: number) {
    for (let i = 0; i < iterations; i++) {
        try {
            const focused = await page.evaluate(
                (selector, i) => {
                    let elements

                    if (i % 2 === 0) {
                        const iframe = document.querySelectorAll('iframe')[0]
                        const iframeDocument =
                            iframe.contentDocument ||
                            iframe.contentWindow.document
                        elements = Array.from(
                            iframeDocument.querySelectorAll(selector),
                        )
                        console.log('search iframes', elements)
                        console.log('search inside iframe')
                    } else {
                        elements = Array.from(
                            document.querySelectorAll(selector),
                        )
                        console.log('search document', elements)
                    }

                    for (const elem of elements) {
                        ;(elem as any).focus()
                        return true
                    }
                    return false
                },
                input,
                i,
            )
            if (focused) {
                return
            } else {
                console.log('input not focused, retrying')
            }
        } catch (e) {
            console.error('Failed to focus input', e)
        }
        await sleep(1000)
    }
}

async function getInput(input: string, page: puppeteer.Page, iterations: number): Promise<string | null> {
    for (let i = 0; i < iterations; i++) {
        try {
            const botName = await page.evaluate(
                (selector, i) => {
                    let elements

                    if (i % 2 === 0) {
                        const iframe = document.querySelectorAll('iframe')[0]
                        const iframeDocument =
                            iframe.contentDocument ||
                            iframe.contentWindow.document
                        elements = Array.from(
                            iframeDocument.querySelectorAll(selector),
                        )
                        console.log('search iframes', elements)
                        console.log('search inside iframe')
                    } else {
                        elements = Array.from(
                            document.querySelectorAll(selector),
                        )
                        console.log('search document', elements)
                    }

                    for (const elem of elements) {
                        return elem.value
                    }
                    return null
                },
                input,
                i,
            )
            if (botName != null) {
                return botName
            } else {
                console.log('input not focused, retrying')
            }
        } catch (e) {
            console.error('Failed to focus input', e)
        }
        await sleep(1000)
    }
    return null
}
async function countParticipants(page: Page): Promise<number> {
    const count = await page.evaluate(() => {
        const images = Array.from(document.querySelectorAll('img'))
        return images.filter(
            (img) => img.clientWidth === 32 && img.clientHeight === 32,
        ).length
    })

    console.log('found', count, 'participants')
    return count
}

async function spokeIsAlone(page: Page): Promise<boolean> {
    return false
    //  try {
    //      const participants = await page.$$('.participantInfo')
    //      console.log('PARTICIPANTS: ', participants?.length)
    //      if (participants && participants.length === 1) {
    //          return true
    //      }
    //  } catch (e) {
    //      CURRENT_MEETING.logger.error(
    //          `[spokeIsAlone] an error occured in spoke is alone: ${e}`,
    //      )
    //  }
    //  return false
}
