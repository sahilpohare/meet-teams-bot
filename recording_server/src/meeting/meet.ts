import * as R from 'ramda'
import * as puppeteer from 'puppeteer'

import {
    CancellationToken,
    MeetingParams,
    MeetingProviderInterface,
    RecordingMode,
} from '../types'
import { JoinError, JoinErrorCode } from '../meeting'

import { Page } from 'puppeteer'
import { screenshot } from '../puppeteer'
import { sleep } from '../utils'

export class MeetProvider implements MeetingProviderInterface {
    constructor() {}
    async parseMeetingUrl(browser: puppeteer.Browser, meeting_url: string) {
        if (meeting_url.startsWith('meet')) {
            meeting_url = `https://${meeting_url}`
        }
        const urlSplitted = meeting_url.split(/\s+/)
        const url = R.find((s) => s.startsWith('https://meet'), urlSplitted)
        if (url == null) {
            throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
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
        await clickDismiss(page)
        await sleep(300)

        console.log(
            'useWithoutAccountClicked:',
            await clickWithInnerText(page, 'span', 'Use without an account', 5),
        )
        await screenshot(page, `before_typing_bot_name`)
        await typeBotName(page, meetingParams.bot_name)
        await screenshot(page, `after_typing_bot_name`)
        await MuteMicrophone(page)
        const askToJoinClicked = await clickWithInnerText(
            page,
            'span',
            'Ask to join',
            10,
        )
        if (!askToJoinClicked) {
            throw new JoinError(JoinErrorCode.CannotJoinMeeting)
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
        }

        await changeLayout(page, meetingParams.recording_mode)
        if (meetingParams.recording_mode !== 'gallery_view') {
            await findShowEveryOne(page, true, cancelCheck)
        }
    }

    async findEndMeeting(
        meetingParams: MeetingParams,
        page: Page,
        cancellationToken: CancellationToken,
    ): Promise<boolean> {
        try {
            if (await findEndMeeting(meetingParams, page, cancellationToken)) {
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
            throw new JoinError(JoinErrorCode.TimeoutWaitingToStart)
        }
        // if (await notAcceptedInMeeting(page)) {
        //     throw new JoinError(JoinErrorCode.BotNotAccepted)
        // }
        try {
            if (await notAcceptedInMeeting(page)) {
                console.log('Bot not accepted, exiting meeting')
                throw new JoinError(JoinErrorCode.BotNotAccepted)
            }
        } catch (error) {
            if (error instanceof JoinError) {
                console.log('Caught JoinError, exiting meeting')
                throw error // This will propagate the error up
            }
            console.error('Unexpected error:', error)
        }
        //TODO: check if bot is removed from meeting
        // if (await removedFromMeeting(page)) {
        //     throw new JoinError(JoinErrorCode.BotRemoved)
        // }
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
    enterMessage = enterMessage.substring(0, 500)
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

async function countParticipantsGaleryView(page: Page): Promise<number> {
    let i = 0

    const iterations = 10
    while (i < iterations) {
        try {
            return await page.$$eval('div[data-self-name]', (elems) => {
                return elems.length
            })
        } catch (e) {
            console.error('exeption in use without an account')
        }
        await sleep(100)
        i += 1
    }
    return 1
}

async function countParticipantsSpeakerView(page: Page): Promise<number> {
    const count = await page.evaluate(() => {
        const images = Array.from(document.querySelectorAll('img'))
        return images.filter(
            (img) => img.clientWidth === 32 && img.clientHeight === 32,
        ).length
    })

    console.log('found', count, 'participants')
    return count
}

async function notAcceptedInMeeting(page: Page): Promise<boolean> {
    try {
        const denied = await page.$$eval('*', (elems) => {
            for (const e of elems) {
                let elem = e as HTMLElement
                if (elem.innerText && typeof elem.innerText === 'string') {
                    if (elem.innerText.includes('denied')) {
                        console.log('XXXXXXXXXXXXXXXXXX User has denied entry')
                        return true
                    }
                }
            }
            return false
        })

        if (denied) {
            console.log('Access denied, throwing JoinError')
            throw new JoinError(JoinErrorCode.BotNotAccepted)
        }

        return false
    } catch (error) {
        if (error instanceof JoinError) {
            throw error
        }
        console.error('Error in notAcceptedInMeeting:', error)
        return false
    }
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
    meetingParams: MeetingParams,
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
        const participant = await (meetingParams.recording_mode ===
        'gallery_view'
            ? countParticipantsGaleryView(page)
            : countParticipantsSpeakerView(page))
        console.log('participant', participant)

        if (participant == 1) {
            return true
        } else if (participant <= 0)  {
            console.error("NO COHERENT PARTICPANT COUNT : ", participant);
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

async function clickDismiss(page: Page): Promise<boolean> {
    try {
        return await page.$$eval('div[role=button]', (elems) => {
            for (const e of elems) {
                let elem = e as any
                if (elem.innerText === 'Dismiss') {
                    elem.click()
                    return true
                }
            }
            return false
        })
    } catch (e) {
        console.error('[joinMeeting] meet find dismiss', e)
        return false
    }
}

export async function clickWithInnerText(
    page: puppeteer.Page,
    htmlType: string,
    innerText: string,
    iterations: number,
    clickParent: boolean = false,
): Promise<boolean> {
    let i = 0
    let buttonClicked = false

    while (!buttonClicked && i < iterations) {
        try {
            buttonClicked = await page.$$eval(
                htmlType,
                (elems, innerText, clickParent) => {
                    let buttonClicked = false
                    for (const e of elems) {
                        let elem = e as any
                        if (elem.innerText === innerText) {
                            buttonClicked = true
                            if (clickParent) {
                                elem.parentElement.click()
                            } else {
                                elem.click()
                            }
                        }
                    }
                    return buttonClicked
                },
                innerText,
                clickParent,
            )
        } catch (e) {
            console.error('exeption in use without an account')
        }
        await sleep(100)
        i += 1
    }
    return buttonClicked
}

async function changeLayout(page: Page, recordingMode: RecordingMode) {
    try {
        console.log(
            'more vert clicked: ',
            await clickWithInnerText(page, 'i', 'more_vert', 10),
        )
        console.log(
            'span change layout clicked: ',
            await clickWithInnerText(page, 'span', 'Change layout', 10),
        )
        if (recordingMode === 'gallery_view') {
            console.log(
                'galery view clicked: ',
                await clickWithInnerText(page, 'span', 'Tiled', 10, true),
            )
        } else {
            console.log(
                'spotlight clicked: ',
                await clickWithInnerText(page, 'span', 'Spotlight', 10, true),
            )
        }
        // click outside the modal to close it
        await sleep(500)
        await page.mouse.click(10, 10)
        await sleep(10)
        await page.mouse.click(10, 10)
        await sleep(10)
        await page.mouse.click(10, 10)
    } catch (e) {}
}

async function typeBotName(page: Page, botName: string) {
    const INPUT = 'input[type=text]'
    const GOT_IT = 'button[aria-label="Got it"]'

    // This triggers:
    // - The "Ask to join" button (good, must be non empty to be clickable)
    // - the "Sign in with your Google Account" popup (bad, defocuses the input while typing)
    await page.focus(INPUT)
    await page.keyboard.type(botName || 'Bot')

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
    await page.keyboard.type(botName)
}

async function MuteMicrophone(page: Page) {
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
                    microphoneButtons.forEach((button) => button.click())
                    console.log(
                        `${microphoneButtons.length} microphone button(s) turned off.`,
                    )
                } else {
                    console.log('No microphone button found. Retrying...')
                    setTimeout(tryClickMicrophone, 1000)
                }
            }

            tryClickMicrophone()
        })
    } catch (e) {
        console.error('Error when trying to turn off the microphone:', e)
    }
}
