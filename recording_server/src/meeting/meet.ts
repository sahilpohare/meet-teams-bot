import * as puppeteer from 'puppeteer'
import * as R from 'ramda'

import {
    CancellationToken,
    MeetingParams,
    MeetingProviderInterface,
} from '../types'

import { Page } from 'puppeteer'
import { screenshot } from '../puppeteer'
import { sleep } from '../utils'

export class MeetProvider implements MeetingProviderInterface {
    constructor() {}
    async parseMeetingUrl(browser: puppeteer.Browser, meeting_url: string) {
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
    getMeetingLink(
        meeting_id: string,
        _password: string,
        _role: number,
        _bot_name: string,
    ) {
        return meeting_id
    }
    async openMeetingPage(
        browser: puppeteer.Browser,
        link: string,
    ): Promise<puppeteer.Page> {
        const url = new URL(link)

        const context = browser.defaultBrowserContext()
        await context.clearPermissionOverrides()
        await context.overridePermissions(url.origin, ['microphone', 'camera'])

        const page = await browser.newPage()
        await page.goto(link, { waitUntil: 'networkidle2' })
        return page
    }
    async joinMeeting(
        page: puppeteer.Page,
        cancelCheck: () => boolean,
        meetingParams: MeetingParams,
    ): Promise<void> {
        console.log('joining meeting')

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
        console.log('after click dismiss:')
        await sleep(300)

        let i = 0
        let useWithoutAccountClicked = false
        while (!useWithoutAccountClicked && i < 5) {
            try {
                useWithoutAccountClicked = await page.$$eval(
                    'span',
                    (elems) => {
                        for (const e of elems) {
                            let elem = e as any
                            if (elem.innerText === 'Use without an account') {
                                elem.click()
                                return true
                            }
                        }
                        return false
                    },
                )
            } catch (e) {
                console.error('exeption in use without an account')
            }
            await sleep(100)
            console.log('Use without an account:', { useWithoutAccountClicked })
            i += 1
        }
        const MuteMicrophone = async () => {
            try {
                await page.evaluate(() => {
                    const tryClickMicrophone = () => {
                        const microphoneButtons = Array.from(
                            document.querySelectorAll('div'),
                        ).filter(
                            (el) =>
                                el.getAttribute('aria-label') &&
                                el
                                    .getAttribute('aria-label')
                                    .includes('Turn off microphone'),
                        )

                        if (microphoneButtons.length > 0) {
                            microphoneButtons.forEach((button) =>
                                button.click(),
                            )
                            console.log(
                                `${microphoneButtons.length} microphone button(s) turned off.`,
                            )
                        } else {
                            console.log(
                                'No microphone button found. Retrying...',
                            )
                            setTimeout(tryClickMicrophone, 1000)
                        }
                    }

                    tryClickMicrophone()
                })
            } catch (e) {
                console.error(
                    'Error when trying to turn off the microphone:',
                    e,
                )
            }
        }

        const typeBotName = async () => {
            const INPUT = 'input[type=text]'
            const GOT_IT = 'button[aria-label="Got it"]'

            // This triggers:
            // - The "Ask to join" button (good, must be non empty to be clickable)
            // - the "Sign in with your Google Account" popup (bad, defocuses the input while typing)
            await page.focus(INPUT)
            await page.keyboard.type(meetingParams.bot_name || 'Bot')

            // Wait for the "Got it" button to appear (probably appeared when typing)
            const foundGotIt = await (async () => {
                try {
                    await page.waitForSelector(GOT_IT, { timeout: 1000 })
                    return true
                } catch (e) {
                    return false
                }
            })()
            console.log('Found "Got it" button?', foundGotIt)

            // Now it is safe to type the bot name, resetting the input first (it's garbage)
            await page.$$eval(INPUT, (elems) => {
                for (const elem of elems) {
                    ;(elem as any).value = ''
                }
            })
            await page.focus(INPUT)
            await page.keyboard.type(meetingParams.bot_name)
        }

        await screenshot(page, `before_typing_bot_name`)
        await typeBotName()
        await screenshot(page, `after_typing_bot_name`)
        await MuteMicrophone()
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

        await findShowEveryOne(page, false, cancelCheck)

        // Send entry message in chat if any
        if (meetingParams.enter_message) {
            console.log('Sending entry message...')
            console.log(
                'send message?',
                await sendEntryMessage(page, meetingParams.enter_message),
            )
            await sleep(100)
        } else {
            console.log('No entry message provided.')
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
        await findShowEveryOne(page, true, cancelCheck)

        console.log('after join meeting')
    }
    async findEndMeeting(
        _meetingParams: MeetingParams,
        page: Page,
        cancellationToken: CancellationToken,
    ): Promise<boolean> {
        try {
            if (await findEndMeeting(page, cancellationToken)) {
                return true
            }
            //console.log('[findendmeeting]  false')
        } catch (e) {
            console.log('[findendmeeting]  error', e)
        }
        return false
    }
}

async function findShowEveryOne(
    page: puppeteer.Page,
    click: boolean,
    cancelCheck: () => boolean,
) {
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
        if (cancelCheck()) {
            throw 'timeout waiting for meeting to start'
        }
        if (await notAcceptedInMeeting(page)) {
            console.log('notAcceptedInMeeting')
            throw 'bot not accepted in meeting'
        }
        if (showEveryOneFound === false) {
            await sleep(1000)
        }
        i++
    }
}
// var textarea = document.querySelector(
//     'textarea[placeholder="Send a message"]',
// )
// textarea.focus()
// textarea.value = enter_message
// var icons = document.querySelectorAll('i')
// var sendIcon = Array.from(icons).find((icon) => icon.textContent === 'send')
// var sendButton = sendIcon ? sendIcon.closest('button') : null

// if (sendButton) {
//     sendButton.click();
// }

async function sendEntryMessage(
    page: Page,
    enterMessage: string,
): Promise<boolean> {
    console.log('Attempting to send entry message...')
    // truncate the message as meet only allows 516 characters
    enterMessage = enterMessage.substring(0, 516)
    try {
        await page.click('button[aria-label="Chat with everyone"]')
        await page.waitForSelector('textarea[placeholder="Send a message"]')

        let res = await page.evaluate(async (message) => {
            const textarea = document.querySelector(
                'textarea[placeholder="Send a message"]',
            )
            if (textarea) {
                ;(textarea as HTMLTextAreaElement).focus()
                ;(textarea as HTMLTextAreaElement).value = message
                textarea.dispatchEvent(new Event('input', { bubbles: true }))

                // Delay to ensure UI processes input before clicking send
                await new Promise<void>((resolve) => {
                    setTimeout(() => {
                        resolve()
                    }, 10000)
                })
                const icons = document.querySelectorAll('i')
                const sendIcon = Array.from(icons).find((icon) =>
                    icon.textContent.includes('send'),
                )
                const sendButton = sendIcon ? sendIcon.closest('button') : null

                if (sendButton) {
                    if (sendButton.disabled) {
                        sendButton.disabled = false // Make sure the send button is clickable
                    }
                    sendButton.click()
                    console.log('Clicked on send button')
                    await new Promise<void>((resolve) => {
                        setTimeout(() => {
                            resolve()
                        }, 10000)
                    })
                    return true
                } else {
                    console.log('Send button not found')
                    return false
                }
            } else {
                console.log('Textarea not found')
                return false
            }
        }, enterMessage)
        page.click('button[aria-label="Chat with everyone"]')
        return res
    } catch (error) {
        console.error('Failed to send entry message:', error)
        return false
    }
}

// try {
//     const CHAT_BUTTON_SELECTOR = 'button[aria-label="Chat with everyone"]'
//     const CHAT_SEND_SELECTOR = 'button[aria-label="Send a message"]'
//     // await clickFirst(CHAT_BUTTON_SELECTOR)
//     console.log(
//         'Click First CHAT_BUTTON_SELECTOR',
//         await clickFirst(page, CHAT_BUTTON_SELECTOR),
//     )
//     await sleep(1000)
//     await page.keyboard.type(enter_message)
//     console.log(
//         'Click First CHAT_SEND_SELECTOR',
//         await clickFirst(page, CHAT_SEND_SELECTOR),
//     )
//     console.log(
//         'Click First CHAT_BUTTON_SELECTOR',
//         await clickFirst(page, CHAT_BUTTON_SELECTOR),
//     )
// } catch (e) {
//     console.error('Unable to send enter message in chat', e)
// }

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

async function clickFirst(
    page: Page,
    selector: string,
    retry: number = 5,
): Promise<boolean> {
    console.log(`clickFirst(${selector})`)
    for (let i = 0; i < retry; i++) {
        if (
            await page.$$eval(selector, (elems) => {
                for (const elem of elems) {
                    ;(elem as any).click()
                    return true
                }
                return false
            })
        ) {
            return true
        } else {
            await sleep(500)
        }
    }
    return false
}
async function notAcceptedInMeeting(page: Page): Promise<boolean> {
    return await page.$$eval('*', (elems) => {
        for (const e of elems) {
            let elem = e as any
            // console.log(elem.innerText)
            if (elem.innerText === "You can't join this call") {
                return true
            }
        }
        return false
    })
}
async function removedFromMeeting(page: Page): Promise<boolean> {
    return await page.$$eval('*', (elems) => {
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

async function findEndMeeting(
    page: Page,
    cancellationToken: CancellationToken,
): Promise<boolean> {
    try {
        if (await removedFromMeeting(page)) {
            console.log('removedFromMeeting')
            return true
        }
    } catch (e) {
        console.error(e)
    }
    try {
        if ((await countParticipants(page)) === 1) {
            return true
        } else {
            cancellationToken.reset()
            return false
        }
    } catch (e) {
        console.error('error happened in count partiicpants', e)
    }
    return false
}
