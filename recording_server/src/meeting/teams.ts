import * as puppeteer from 'puppeteer'

import { JoinError, JoinErrorCode } from '../meeting'
import {
    CancellationToken,
    MeetingParams,
    MeetingProviderInterface,
} from '../types'

import { Page } from 'puppeteer'
import { Logger } from '../logger'
import { parseMeetingUrlFromJoinInfos } from '../urlParser/teamsUrlParser'
import { sleep } from '../utils'

export class TeamsProvider implements MeetingProviderInterface {
    constructor() {}
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
        console.log({ url })

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
        console.log('joining meeting', cancelCheck)

        await clickWithInnerText(page, 'button', 'Continue on this browser', 5)

        const NewInterface =
            (await Promise.race([
                (async () => {
                    const hasJoinButton = await clickWithInnerText(
                        page,
                        'button',
                        'Join now',
                        600,
                        false,
                    )
                    console.log('hasJoinButton', hasJoinButton)
                    return hasJoinButton ? true : undefined
                })(),
                (async () => {
                    const hasContinueButton = await clickWithInnerText(
                        page,
                        'button',
                        'Continue without audio or video',
                        600,
                        true,
                    )
                    console.log('hasContinueButton', hasContinueButton)
                    return hasContinueButton ? false : undefined
                })(),
            ])) ?? false


        await clickWithInnerText(page, 'button', 'Join now', 300, false)
        await Logger.instance.screenshot(page, `joinNowFound`)
        if (NewInterface) {
            console.log('NEW INTERFACE !!!!!!!!!')
            await handlePermissionDialog(page)
            await activateCamera(page)
        }
        await Logger.instance.screenshot(page, `beforetypebotname`)
        await typeBotName(page, meetingParams.bot_name, 20)
        await Logger.instance.screenshot(page, `aftertypebotname`)
        await clickWithInnerText(page, 'button', 'Join now', 20)

        await Logger.instance.screenshot(page, `afterjoinnow`)

        while (true) {
            const botNotAccepted = await isBotNotAccepted(page)
            if (botNotAccepted) {
                throw new JoinError(JoinErrorCode.BotNotAccepted)
            }
            const clickSuccess = await clickWithInnerText(
                page,
                'button',
                'React',
                2,
                false,
            )
            if (cancelCheck?.()) {
                throw new JoinError(JoinErrorCode.TimeoutWaitingToStart)
            }
            if (clickSuccess) {
                break
            }
            await sleep(2000)
        }
        if (await clickWithInnerText(page, 'button', 'View', 2, false)) {
            if (meetingParams.recording_mode !== 'gallery_view') {
                await clickWithInnerText(page, 'button', 'View', 10)
                await clickWithInnerText(page, 'div', 'Speaker', 20)
            }
        } else {
            console.warn('New light interface Teams')
        }
    }

    async findEndMeeting(
        _meetingParams: MeetingParams,
        page: Page,
        _cancellationToken: CancellationToken,
    ): Promise<boolean> {
        return await isRemovedFromTheMeeting(page)
    }
}

async function typeBotName(
    page: puppeteer.Page,
    botName: string,
    iterations: number,
): Promise<boolean> {
    console.log('Starting to type bot name...')
    const methodSetValue = async () => {
        const focused = await focusInput(INPUT_BOT, page, 2)
        if (focused === null) return false;

        await page.evaluate((selector, name) => {
            const input = document.querySelector(selector) as HTMLInputElement;
            if (input) {
                input.focus();
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, name);
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, INPUT_BOT, botName);
        
        await sleep(500);
        return await checkInputValue(page, INPUT_BOT) === botName;
    };

    const methodKeyboard = async () => {
        const focused = await focusInput(INPUT_BOT, page, 2)
        if (focused === null) return false;
        
        await page.keyboard.type(botName, { delay: 100 });
        await sleep(500);
        return await checkInputValue(page, INPUT_BOT) === botName;
    };

    for (let i = 0; i < iterations; i++) {
        try {
            // Méthode 1: Set Value
            console.log('Trying method 1: Direct value setting...')
            if (await methodSetValue()) {
                console.log('✅ Success: Bot name set directly')
                return true;
            }

            // Méthode 2: Keyboard
            console.log('Trying method 2: Keyboard simulation...')
            if (await methodKeyboard()) {
                console.log('✅ Success: Bot name typed via keyboard')
                return true;
            }

            console.log('❌ Both methods failed, retrying...')
            await sleep(1000)
        } catch (e) {
            console.error('Failed attempt:', e)
        }
    }
    
    console.error(`❌ Failed to type bot name after ${iterations} attempts`)
    return false;
}

async function checkInputValue(page: puppeteer.Page, selector: string): Promise<string | null> {
    return await page.evaluate((sel) => {
        const input = document.querySelector(sel) as HTMLInputElement;
        return input ? input.value : null;
    }, selector);
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
        } catch (e) {}
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
        } catch (e) {}
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
    cancelCheck?: () => boolean,
): Promise<boolean> {
    let i = 0
    iterations = iterations
    let continueButton = false

    while (
        !continueButton &&
        (iterations == null || i < iterations) &&
        !cancelCheck?.()
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
        } catch (e) {}
        await sleep(1000)
        console.log(
            `${innerText} ${click ? 'clicked' : 'found'} :`,
            continueButton,
        )
        i += 1
    }
    return continueButton
}

const INPUT_BOT = 'input[placeholder="Type your name"]'
async function focusInput(
    input: string,
    page: puppeteer.Page,
    iterations: number,
): Promise<string | null> {
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
                    } else {
                        elements = Array.from(
                            document.querySelectorAll(selector),
                        )
                    }

                    for (const elem of elements) {
                        ;(elem as any).focus()
                        return elem.value
                    }
                    return null
                },
                input,
                i,
            )
            if (focused != null) {
                return focused
            } else {
                console.log('input not focused, retrying')
            }
        } catch (e) {}
        await sleep(1000)
    }
    return null
}

async function checkPageForText(
    page: Page,
    textToFind: string,
    logMessage: string,
): Promise<boolean> {
    const result = await page.evaluate((text) => {
        function containsText(doc: Document): boolean {
            return doc.body.textContent.includes(text)
        }

        if (containsText(document)) {
            return true
        }

        const iframes = document.querySelectorAll('iframe')
        for (const iframe of iframes) {
            const doc = iframe.contentDocument || iframe.contentWindow.document
            if (doc && containsText(doc)) {
                return true
            }
        }

        return false
    }, textToFind)

    console.log(logMessage, result)
    return result
}

async function isRemovedFromTheMeeting(page: Page): Promise<boolean> {
    // if no leave button, then the bot has been removed from the meeting
    if (!(await clickWithInnerText(page, 'button', 'Leave', 4, false))) {
        console.log('no leave button found, Bot removed from the meeting')
        return true
    } else {
        return false
    }
}

async function isBotNotAccepted(page: Page): Promise<boolean> {
    return checkPageForText(
        page,
        'Sorry, but you were denied access to the meeting.',
        'Bot not accepted:',
    )
}

async function handlePermissionDialog(page: puppeteer.Page): Promise<void> {
    console.log('handling permission dialog')
    try {
        // Utilise clickWithInnerText pour cliquer sur le bouton OK
        const clicked = await clickWithInnerText(page, 'button', 'OK', 5)
        if (clicked) {
            console.log('Permission dialog handled successfully')
        } else {
            console.log('No permission dialog found or failed to click OK')
        }
    } catch (error) {
        console.error('Failed to handle permission dialog:', error)
    }
}

async function activateCamera(page: puppeteer.Page): Promise<void> {
    console.log('activating camera')
    try {
        // D'abord vérifier si le message "Your camera is turned off" est présent
        const hasCameraOffText = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('span')).some(
                (span) => span.textContent === 'Your camera is turned off',
            )
        })

        if (hasCameraOffText) {
            // Utiliser clickWithInnerText pour cliquer sur le bouton de la caméra
            // Chercher le bouton avec le titre "Camera"
            const clicked = await clickWithInnerText(
                page,
                'button',
                'Camera',
                5,
            )

            if (clicked) {
                console.log('Camera button clicked successfully')
                await page.waitForTimeout(1000)
            } else {
                console.log('Failed to find or click camera button')
            }
        } else {
            console.log('Camera is already on or text not found')
        }
    } catch (error) {
        console.error('Failed to activate camera:', error)
    }
}
