import * as puppeteer from 'puppeteer'
import { Page } from 'puppeteer'
import { sleep } from '../utils'
import { CURRENT_MEETING, MeetingParams } from '../meeting'
import * as R from 'ramda'
import { screenshot } from '../puppeteer'

export async function parseMeetingUrl(
    browser: puppeteer.Browser,
    meeting_url: string,
) {
    // try parsing this liinks
    // To join the video meeting, click this link: https://meet.google.com/zdg-teai-fhz
    // Otherwise, to join by phone, dial +33 1 87 40 48 44 and enter this PIN: 983 713 164#
    // To view more phone numbers, click this link: https://tel.meet/zdg-teai-fhz?hs=5

    if (meeting_url.startsWith('meet')) {
        meeting_url = `https://${meeting_url}`
    }
    const urlSplitted = meeting_url.split(/\s+/)
    const url = R.find((s) => s.startsWith('https://meet'), urlSplitted)
    if (url == null) {
        throw 'bad meeting url'
    }
    return { meetingId: url, password: '' }
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
    await context.overridePermissions(url.origin, ['microphone', 'camera'])

    const page = await browser.newPage()
    await page.goto(link, { waitUntil: 'networkidle2' })
    return page
}

export async function joinMeeting(
    page: puppeteer.Page,
    meetingParams: MeetingParams,
): Promise<void> {
    CURRENT_MEETING.logger.info('joining meeting')

    try {
        await page.$$eval('div[role=button]', (elems) => {
            for (const e of elems) {
                let elem = e as any
                if (elem.innerText === 'Dismiss') {
                    elem.click()
                }
            }
        })
    } catch (e) {
        console.error('[joinMeeting] meet find dismiss', e)
    }
    await sleep(300)

    let i = 0
    let useWithoutAccountClicked = false
    while (!useWithoutAccountClicked && i < 5) {
        try {
            useWithoutAccountClicked = await page.$$eval('span', (elems) => {
                for (const e of elems) {
                    let elem = e as any
                    if (elem.innerText === 'Use without an account') {
                        elem.click()
                        return true
                    }
                }
                return false
            })
        } catch (e) {
            console.error('exeption in use without an account')
        }
        await sleep(100)
        console.log('Use without an account:', { useWithoutAccountClicked })
        i += 1
    }
    await screenshot(page, `before_typing_bot_name`)
    await page.focus('input[type=text]')
    await page.keyboard.type(meetingParams.bot_name)
    await screenshot(page, `after_typing_bot_name`)

    console.log('after click dismiss:')
    let askToJoinClicked = false
    i = 0
    while (!askToJoinClicked && i < 10) {
        askToJoinClicked = await page.$$eval('span', (elems) => {
            for (const e of elems) {
                let elem = e as any
                if (elem.innerText === 'Ask to join') {
                    elem.click()
                    return true
                }
            }
            return false
        })
        await sleep(100)
        console.log('ask to join clicked:', { askToJoinClicked })
        i += 1
    }
    if (!askToJoinClicked) {
        throw "Error bot can't join"
    }

    await findShowEveryOne(page, false)

    // Send a message in chat
    try {
        const CHAT_WITH_EVERYONE = 'button[aria-label="Chat with everyone"]'
        const SEND_A_MESSAGE = 'button[aria-label="Send a message"]'
        const message = "Hello, world! I'm a bot." // TODO

        clickFirst(CHAT_WITH_EVERYONE)
        await sleep(1000)
        await page.keyboard.type(message)
        clickFirst(SEND_A_MESSAGE)
        clickFirst(CHAT_WITH_EVERYONE)
    } catch (e) {
        console.error('Error caught when sending message in chat', e)
    }

    try {
        await page.$$eval('i', (elems) => {
            for (const e of elems) {
                let elem = e as any
                if (elem.innerText === 'more_vert') {
                    elem.click()
                }
            }
        })
        await sleep(100)
        console.log('found more vert')
        await page.$$eval('span', (elems) => {
            for (const e of elems) {
                let elem = e as any
                if (elem.innerText === 'Change layout') {
                    elem.click()
                }
            }
        })
        await sleep(500)
        console.log('found change layout')
        const spotlightFound = await page.$$eval('span', (elems) => {
            for (const e of elems) {
                let elem = e as any
                console.log(elem.innerText)
                if (elem.innerText === 'Spotlight') {
                    elem.parentElement.click()
                    return true
                }
            }
            return false
        })
        await sleep(500)
        console.log('found spotlight', { spotlightFound })
        await page.mouse.click(10, 10)
        await sleep(10)
        await page.mouse.click(10, 10)
        await sleep(10)
        await page.mouse.click(10, 10)
    } catch (e) {}
    await sleep(500)
    await findShowEveryOne(page, true)

    CURRENT_MEETING.logger.info('after join meeting')
}

async function findShowEveryOne(page: puppeteer.Page, click: boolean) {
    let showEveryOneFound = false
    let i = 0

    while (showEveryOneFound === false) {
        showEveryOneFound = await page.$$eval(
            'button',
            (elems, click) => {
                for (const e of elems) {
                    let elem = e as any
                    if (elem.ariaLabel === 'Show everyone') {
                        if (click) {
                            elem.click()
                        }
                        return true
                    }
                }
                return false
            },
            click,
        )
        await screenshot(page, `findShowEveryone`)
        console.log({ showEveryOneFound })
        if (i > 60 * 15) {
            throw 'Timeout accepting the bot'
        }
        if (showEveryOneFound === false) {
            await sleep(1000)
        }
        i++
    }
}

async function countParticipants(page: Page): Promise<number> {
    const count = await page.evaluate(() => {
        const images = Array.from(document.querySelectorAll('img'))
        return images.filter(
            (img) => img.clientWidth === 32 && img.clientHeight === 32,
        ).length
    })
    return count
}

async function removedFromMeeting(page: Page): Promise<boolean> {
    return await page.$$eval('div', (elems) => {
        for (const e of elems) {
            let elem = e as any
            // console.log(elem.innerText)
            if (
                elem.innerText === "You've been removed from the meeting" ||
                elem.innerText === 'The call ended because everyone left'
            ) {
                return true
            }
        }
        return false
    })
}

async function findEndMeeting(page: Page): Promise<boolean> {
    try {
        if (await removedFromMeeting(page)) {
            return true
        }
    } catch (e) {
        console.error(e)
    }
    try {
        const numberParticipants = await countParticipants(page)
        //const numberOfBot = await numberOfBotInMeeting()
        if (numberParticipants === 1) {
            return true
        }
    } catch (e) {
        console.error(e)
    }
    return false
}

export async function waitForEndMeeting(
    _meetingParams: MeetingParams,
    page: Page,
) {
    CURRENT_MEETING.logger.info('[waitForEndMeeting]')
    while (CURRENT_MEETING && CURRENT_MEETING.status == 'Recording') {
        try {
            if (await findEndMeeting(page)) {
                break
            }
            //CURRENT_MEETING.logger.info('[findendmeeting]  false')
        } catch (e) {
            CURRENT_MEETING.logger.info('[findendmeeting]  error', e)
        }
        await sleep(5000)
    }
}

function clickFirst(selector: string) {
    console.log(`clickFirst(${selector})`)
    page.$$eval(selector, (elems) => {
        for (const elem of elems) {
            ;(elem as any).click()
            break
        }
    })
}
