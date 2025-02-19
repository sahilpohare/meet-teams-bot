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

        try {
            await ensurePageLoaded(page)
        } catch (error) {
            console.error('Page load failed:', error)
            // On throw une Error simple (pas JoinError) pour que meeting.ts fasse un retry
            throw new Error('Page failed to load - retrying')
        }

        try {
            await clickWithInnerText(
                page,
                'button',
                'Continue on this browser',
                5,
            )
        } catch (e) {
            console.warn('Failed to click "Continue on this browser":', e)
        }

        const NewInterface = await tryFindInterface(page)
        console.log(
            'interface : ',
            NewInterface
                ? 'light 🥕🥕'
                : (await page.url()).includes('live')
                  ? 'live 💃🏼'
                  : 'old 👴🏻',
        )

        //be sure the page is loaded
        try {
            await clickWithInnerText(page, 'button', 'Join now', 100, false)
        } catch (e) {
            console.warn('Failed to find "Join now" button (first attempt):', e)
        }

        if (NewInterface) {
            try {
                await handlePermissionDialog(page)
                await activateCamera(page)
            } catch (e) {
                console.warn(
                    'Failed to handle camera and permissions, continuing anyway:',
                    e,
                )
                // On ajoute un délai pour laisser le temps à l'interface de se stabiliser
                await sleep(2000)
            }
        }

        try {
            await typeBotName(page, meetingParams.bot_name, 20)
            await clickWithInnerText(page, 'button', 'Join now', 20)
        } catch (e) {
            console.error(
                'Error during bot name typing or second "Join now" click:',
                e,
            )
        }

        await Logger.instance.screenshot(page, `afterjoinnow`)

        while (true) {
            const botNotAccepted = await isBotNotAccepted(page)
            if (botNotAccepted) {
                throw new JoinError(JoinErrorCode.BotNotAccepted)
            }
            // const clickSuccess = (
            //     await Promise.all([
            //         clickWithInnerText(page, 'button', 'View', 2, false),
            //         clickWithInnerText(page, 'button', 'React', 2, false),
            //     ])
            // ).some((result) => result)

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

            await sleep(500)
        }

        try {
            if (await clickWithInnerText(page, 'button', 'View', 10, false)) {
                if (meetingParams.recording_mode !== 'gallery_view') {
                    await clickWithInnerText(page, 'button', 'View', 10)
                    await clickWithInnerText(page, 'div', 'Speaker', 20)
                }
            }
        } catch (e) {
            console.error('Error handling "View" or "Speaker" mode:', e)
        }
    }

    async findEndMeeting(
        _meetingParams: MeetingParams,
        page: Page,
        _cancellationToken: CancellationToken,
        isRecording?: boolean,
    ): Promise<boolean> {
        return await isRemovedFromTheMeeting(page)
    }
}

async function typeBotName(
    page: puppeteer.Page,
    botName: string,
    iterations: number,
): Promise<boolean> {
    await ensurePageLoaded(page)

    console.log('Starting to type bot name...')
    const methodSetValue = async () => {
        const focused = await focusInput(INPUT_BOT, page, 2)
        if (focused === null) return false

        await page.evaluate(
            (selector, name) => {
                const input = document.querySelector(
                    selector,
                ) as HTMLInputElement
                if (input) {
                    input.focus()
                    Object.getOwnPropertyDescriptor(
                        HTMLInputElement.prototype,
                        'value',
                    ).set.call(input, name)
                    input.dispatchEvent(new Event('input', { bubbles: true }))
                }
            },
            INPUT_BOT,
            botName,
        )

        await sleep(500)
        return (await checkInputValue(page, INPUT_BOT)) === botName
    }

    const methodKeyboard = async () => {
        const focused = await focusInput(INPUT_BOT, page, 2)
        if (focused === null) return false

        await page.keyboard.type(botName, { delay: 100 })
        await sleep(500)
        return (await checkInputValue(page, INPUT_BOT)) === botName
    }

    for (let i = 0; i < iterations; i++) {
        try {
            // Méthode 1: Set Value
            console.log('Trying method 1: Direct value setting...')
            if (await methodSetValue()) {
                console.log('✅ Success: Bot name set directly')
                return true
            }

            // Méthode 2: Keyboard
            console.log('Trying method 2: Keyboard simulation...')
            if (await methodKeyboard()) {
                console.log('✅ Success: Bot name typed via keyboard')
                return true
            }

            console.log('❌ Both methods failed, retrying...')
            await sleep(500)
        } catch (e) {
            console.error('Failed attempt:', e)
        }
    }

    console.error(`❌ Failed to type bot name after ${iterations} attempts`)
    return false
}

async function checkInputValue(
    page: puppeteer.Page,
    selector: string,
): Promise<string | null> {
    await ensurePageLoaded(page)
    return await page.evaluate((sel) => {
        const input = document.querySelector(sel) as HTMLInputElement
        return input ? input.value : null
    }, selector)
}
export async function innerTextWithSelector(
    page: puppeteer.Page,
    selector: string,
    message: string,
    iterations: number,
): Promise<boolean> {
    let i = 0
    let continueButton = false
    await ensurePageLoaded(page)

    while (!continueButton && i < iterations) {
        try {
            continueButton = await page.evaluate(
                (selector, i, message) => {
                    let elements
                    const iframe = document.querySelectorAll('iframe')[0]

                    if (i % 2 === 0 && iframe) {
                        const docInIframe =
                            iframe.contentDocument ||
                            iframe.contentWindow.document
                        elements = Array.from(
                            docInIframe.querySelectorAll(selector),
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
            if (i >= iterations - 2) {
                //Log only on 2 last attempt
                console.error(`Error in clickWithInnerText (last attempt):`, e)
            }
            continueButton = false
        }
        await sleep(200)
        console.log(
            `element with selector ${selector} clicked:`,
            continueButton,
        )
    }
    return continueButton
}

async function tryFindInterface(page: puppeteer.Page): Promise<boolean> {
    // Ajouter des logs de métriques
    const metrics = await page.metrics();
    console.log('Page metrics:', {
        JSHeapUsedSize: Math.round(metrics.JSHeapUsedSize / 1024 / 1024) + 'MB',
        JSHeapTotalSize: Math.round(metrics.JSHeapTotalSize / 1024 / 1024) + 'MB',
        Nodes: metrics.Nodes,
        ScriptDuration: Math.round(metrics.ScriptDuration * 1000) + 'ms'
    });
    
    const controller = new AbortController()
    const signal = controller.signal
    await ensurePageLoaded(page)

    try {
        await Promise.race([
            clickWithInnerText(
                page,
                'button',
                'Join now',
                600,
                false,
                () => signal.aborted,
            ),
            clickWithInnerText(
                page,
                'button',
                'Continue without audio or video',
                600,
                false,
                () => signal.aborted,
            ),
        ])

        // Annule l'autre recherche dès qu'on a un résultat
        controller.abort()

        if (await clickWithInnerText(page, 'button', 'Join now', 6, false)) {
            console.log('Found Join now interface')
            return true
        } else {
            await clickWithInnerText(
                page,
                'button',
                'Continue without audio or video',
                6,
                true,
            )
            console.log('Found Continue without audio/video interface')
            return false
        }
    } catch (error) {
        console.error('Error detecting interface:', error)
        throw new Error('RetryableError: Interface detection failed')
    }
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
    let continueButton = false
    if (!(await ensurePageLoaded(page))) {
        console.error('Page is not fully loaded at the start.')
        return false
    }
    while (
        !continueButton &&
        (iterations == null || i < iterations) &&
        !cancelCheck?.()
    ) {
        try {
            if (i % 5 === 0) {
                // Toutes les 5 itérations
                const isPageLoaded = await ensurePageLoaded(page)
                if (!isPageLoaded) {
                    console.error('Page seems frozen or not responding.')
                    return false // Stop si la page ne répond plus
                }
            }
            continueButton = await page.evaluate(
                (innerText, htmlType, i, click) => {
                    let elements
                    const iframe = document.querySelectorAll('iframe')[0]

                    var iframes = document.querySelectorAll('iframe')
                    console.log('iframes : ', iframes)
                    if (i % 2 === 0 && iframes.length > 0) {
                        const premierIframe = iframes[0]
                        const documentDansIframe =
                            premierIframe.contentDocument ||
                            premierIframe.contentWindow?.document

                        if (documentDansIframe) {
                            elements = Array.from(
                                documentDansIframe.querySelectorAll(htmlType) ||
                                    [],
                            )
                        } else {
                            console.warn('Iframe document is not accessible')
                            elements = []
                        }
                    } else {
                        elements = Array.from(
                            document.querySelectorAll(htmlType),
                        )
                    }

                    for (const e of elements) {
                        let elem = e as any
                        if (elem.innerText === innerText) {
                            if (click) elem.click()
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
            if (i === iterations - 1) {
                // Log uniquement à la dernière itération
                console.error(`Error in clickWithInnerText (last attempt):`, e)
            }
            continueButton = false
        }
        await sleep(100 + i * 100)
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
        await sleep(500)
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
    try {
        // Vérifie que la page est toujours chargée
        if (!(await ensurePageLoaded(page))) {
            return true
        }
        // Vérifie si le bouton "Raise" est présent
        const buttonExists = await clickWithInnerText(
            page,
            'button',
            'Raise',
            4,
            false,
        )

        if (!buttonExists) {
            console.log('no leave button found, Bot removed from the meeting')
            return true
        }
        return false
    } catch (error) {
        console.error('Error while checking meeting status:', error)
        return false // Retourne false en cas d'erreur
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
                sleep(500)
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
async function ensurePageLoaded(
    page: puppeteer.Page,
    timeout = 45000,
): Promise<boolean> {
    try {
        await page.waitForFunction(() => document.readyState === 'complete', {
            timeout,
        })
        return true
    } catch (error) {
        try {
            // Ajout d'un timeout sur la prise de screenshot
            await Promise.race([
                Logger.instance.screenshot(page, 'page_not_loaded_' + Date.now()),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Screenshot timeout')), 5000)
                )
            ]).catch(err => {
                console.error('Screenshot failed or timed out:', err)
            })
        } catch (error) {
            console.error('Failed to screenshot page:', error)
        }
        console.error('Failed to ensure page is loaded:', error)
        throw new Error('RetryableError: Page load timeout')
    }
}
