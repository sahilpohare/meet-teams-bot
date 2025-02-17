import * as puppeteer from 'puppeteer'

import { JoinError, JoinErrorCode } from '../meeting'
import {
    CancellationToken,
    MeetingParams,
    MeetingProviderInterface,
    RecordingMode,
} from '../types'

import { Page } from 'puppeteer'
import { FrameAnalyzer } from '../FrameAnalyzer'
import { Logger } from '../logger'
import { parseMeetingUrlFromJoinInfos } from '../urlParser/meetUrlParser'
import { sleep } from '../utils'

export class MeetProvider implements MeetingProviderInterface {
    private frameAnalyzer: FrameAnalyzer

    constructor() {
        this.frameAnalyzer = FrameAnalyzer.getInstance()
        this.frameAnalyzer.initialize().catch(console.error)
    }

    async parseMeetingUrl(browser: puppeteer.Browser, meeting_url: string) {
        return parseMeetingUrlFromJoinInfos(meeting_url)
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
        streaming_input: string | undefined,
    ): Promise<puppeteer.Page> {
        const url = new URL(link)

        const context = browser.defaultBrowserContext()
        await context.clearPermissionOverrides()
        if (streaming_input) {
            await context.overridePermissions(url.origin, [
                'microphone',
                'camera',
            ])
        } else {
            await context.overridePermissions(url.origin, ['camera'])
        }

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
        let maxAttempts = 5

        console.log(
            'useWithoutAccountClicked:',
            await clickWithInnerText(
                page,
                'span',
                ['Use without an account'],
                5,
            ),
        )
        await Logger.instance.screenshot(page, `before_typing_bot_name`)
        for (let attempt = 1; attempt <= 5; attempt++) {
            if (await typeBotName(page, meetingParams.bot_name)) {
                console.log('Bot name typed at attempt', attempt)
                break
            }
            await Logger.instance.screenshot(
                page,
                `bot_name_typing_failed_attempt_${attempt}`,
            )
            await clickOutsideModal(page)
            await page.waitForTimeout(500)
        }
        // await typeBotName(page, meetingParams.bot_name)
        await Logger.instance.screenshot(page, `after_typing_bot_name`)
        // await MuteMicrophone(page)
        const askToJoinClicked = await clickWithInnerText(
            page,
            'span',
            ['Ask to join', 'Join now'],
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

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (await changeLayout(page, meetingParams.recording_mode)) {
                console.log(
                    `Changement de disposition réussi à la tentative ${attempt}.`,
                )
                break
            }

            console.log(`Tentative ${attempt} échouée.`)
            await Logger.instance.screenshot(
                page,
                `layout_change_failed_attempt_${attempt}`,
            )

            await clickOutsideModal(page)
            await page.waitForTimeout(500)
        }

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
            if (!page.isClosed()) {
                try {
                    const elements = await page.$$('*');
                    for (const element of elements) {
                        const text = await element.evaluate(el => (el as HTMLElement).innerText);
                        if (text?.includes("You've been removed") ||
                            text?.includes('The call ended') ||
                            text?.includes('Return to home')) {
                            console.log('End meeting detected through page content:', text);
                            return true;
                        }
                    }
                } catch (e) {
                    console.log('Page access failed, falling back to OCR');
                }
            }
            console.log('OCR, trying to find end meeting')
            // Si la page n'est pas accessible, utiliser l'OCR
            const frameAnalyzer = FrameAnalyzer.getInstance()

            const lastText = frameAnalyzer.getLastFrameText()
            if (
                lastText?.includes("You've been removed") ||
                lastText?.includes('The call ended') ||
                lastText?.includes('Return to home')
            ) {
                console.log('End meeting detected through OCR:', lastText)
                return true
            }
            return false
        } catch (error) {
            console.error('Error in findEndMeeting:', error)
            return false
        }
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
                    // 2024-08-26 : 'People' seems to be the new ariaLabel value and it replaces 'Show everyone'
                    if (
                        elem.ariaLabel === 'Show everyone' ||
                        elem.ariaLabel === 'People'
                    ) {
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
        await Logger.instance.screenshot(page, `findShowEveryone`)
        console.log({ showEveryOneFound })
        if (cancelCheck()) {
            throw new JoinError(JoinErrorCode.TimeoutWaitingToStart)
        }
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
        if (showEveryOneFound === false) {
            await sleep(1000)
        }
        i++
    }
}

async function sendEntryMessage(
    page: Page,
    enterMessage: string,
): Promise<boolean> {
    console.log('Attempting to send entry message...')
    // truncate the message as meet only allows 516 characters
    enterMessage = enterMessage.substring(0, 500)
    try {
        await page.click('button[aria-label="Chat with everyone"]')
        await page.waitForSelector(
            'textarea[placeholder="Send a message"], textarea[aria-label="Send a message to everyone"]',
        )

        let res = await page.evaluate(async (message) => {
            const textarea = document.querySelector(
                'textarea[placeholder="Send a message"], textarea[aria-label="Send a message to everyone"]',
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
                        sendButton.disabled = false
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

//TODO: if someone join the meeting the bot leave the meeting
async function removedFromMeeting(page: Page): Promise<boolean> {
    try {
        const REMOVAL_MESSAGES = [
            "You've been removed",
            'The call ended',
            'Return to home',
            "You've been removed from the meeting",
        ]
        const RETRY_DELAY = 500

        const checkForRemoval = async () => {
            return await page.evaluate((messages) => {
                const elements = document.querySelectorAll('*')

                for (const element of elements) {
                    const text = element.textContent || ''

                    // Still in meeting if we see 'Leave call'
                    if (text.includes('Leave call')) {
                        console.log('Leave call found, still in meeting')
                        return false
                    }

                    // Check for any removal messages
                    if (messages.some((msg) => text.includes(msg))) {
                        console.log('Removal message found, removed bot')
                        return true
                    }
                }
                return false
            }, REMOVAL_MESSAGES)
        }

        // First check
        const firstCheck = await checkForRemoval()
        if (firstCheck) {
            return true
        }

        // Wait and do second check
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY))
        return await checkForRemoval()
    } catch (error) {
        console.error('Error in removedFromMeeting:', error)
        if (error instanceof Error) {
            console.error('Error details:', {
                name: error.name,
                message: error.message,
                stack: error.stack,
            })
        }
        return false
    }
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
    innerText: string[],
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
                        for (const text of innerText as string[]) {
                            if (elem.innerText === text) {
                                buttonClicked = true
                                if (clickParent) {
                                    elem.parentElement.click()
                                } else {
                                    elem.click()
                                }
                                break
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

async function changeLayout(
    page: Page,
    recordingMode: RecordingMode,
): Promise<boolean> {
    try {
        const moreVertClicked = await clickWithInnerText(
            page,
            'i',
            ['more_vert'],
            10,
        )
        console.log('more vert clicked: ', moreVertClicked)
        if (!moreVertClicked) return false

        const changeLayoutClicked = await clickWithInnerText(
            page,
            'span',
            ['Change layout'],
            10,
        )
        console.log('span change layout clicked: ', changeLayoutClicked)
        if (!changeLayoutClicked) return false

        let layoutChangeSuccessful = false
        if (recordingMode === 'gallery_view') {
            layoutChangeSuccessful = await clickWithInnerText(
                page,
                'span',
                ['Tiled'],
                10,
                true,
            )
            console.log('gallery view clicked: ', layoutChangeSuccessful)
        } else {
            layoutChangeSuccessful = await clickWithInnerText(
                page,
                'span',
                ['Spotlight'],
                10,
                true,
            )
            console.log('spotlight clicked: ', layoutChangeSuccessful)
            //TODO: ajouter une capture d'écran si false
        }

        if (!layoutChangeSuccessful) return false

        await clickOutsideModal(page)
        // click outside the modal to close it

        return true
    } catch (e) {
        console.error('Error in changeLayout:', e)
        return false
    }
}

async function clickOutsideModal(page: Page) {
    await sleep(500)
    await page.mouse.click(10, 10)
    await sleep(10)
    await page.mouse.click(10, 10)
    await sleep(10)
    await page.mouse.click(10, 10)
}

async function typeBotName(page: Page, botName: string): Promise<boolean> {
    const INPUT = 'input[type=text]'
    const BotNameTyped = botName || 'Bot'

    try {
        await page.waitForSelector(INPUT, { timeout: 1000 })

        await page.$$eval(INPUT, (elems) => {
            for (const elem of elems) {
                ;(elem as any).value = ''
            }
        })
        await page.focus(INPUT)
        await page.keyboard.type(BotNameTyped)
        return await page.$$eval(
            INPUT,
            (elems, BotNameTyped) => {
                for (const elem of elems) {
                    return (elem as any).value.includes(BotNameTyped)
                }
            },
            BotNameTyped,
        )
    } catch (e) {
        console.error('error in typeBotName', e)
        return false
    }
}

// async function MuteMicrophone(page: Page) {
//     try {
//         await page.evaluate(() => {
//             const tryClickMicrophone = () => {
//                 const microphoneButtons = Array.from(
//                     document.querySelectorAll('div'),
//                 ).filter(
//                     (el) =>
//                         el.getAttribute('aria-label') &&
//                         el
//                             .getAttribute('aria-label')
//                             .includes('Turn off microphone'),
//                 )

//                 if (microphoneButtons.length > 0) {
//                     microphoneButtons.forEach((button) => button.click())
//                     console.log(
//                         `${microphoneButtons.length} microphone button(s) turned off.`,
//                     )
//                 } else {
//                     console.log('No microphone button found. Retrying...')
//                     setTimeout(tryClickMicrophone, 1000)
//                 }
//             }

//             tryClickMicrophone()
//         })
//     } catch (e) {
//         console.error('Error when trying to turn off the microphone:', e)
//     }
// }
