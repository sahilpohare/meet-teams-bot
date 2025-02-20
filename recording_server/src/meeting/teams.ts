import { BrowserContext, Page } from '@playwright/test'

import {
    JoinError, JoinErrorCode, MeetingParams,
    MeetingProviderInterface
} from '../types'

import { Logger } from '../logger'
import { parseMeetingUrlFromJoinInfos } from '../urlParser/teamsUrlParser'
import { sleep } from '../utils'

export class TeamsProvider implements MeetingProviderInterface {
    constructor() {}
    async parseMeetingUrl(meeting_url: string) {
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
        browserContext: BrowserContext,
        link: string,
        streaming_input: string | undefined,
    ): Promise<Page> {
        const url = new URL(link)
        const page = await browserContext.newPage()
        
        await page.goto(link, { waitUntil: 'networkidle' })
        return page
    }

    async joinMeeting(
        page: Page,
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
            throw new Error('RetryableError')
        }

        await findShowEveryOne(page, false, cancelCheck)
    }

    async findEndMeeting(
        meetingParams: MeetingParams,
        page: Page,
        // cancellationToken: CancellationToken,
    ): Promise<boolean> {
        try {
            if (await isRemovedFromTheMeeting(page)) {
                return true
            }

            if (await isBotNotAccepted(page)) {
                throw new JoinError(JoinErrorCode.BotNotAccepted)
            }

            return false
        } catch (error) {
            if (error instanceof JoinError) {
                throw error
            }
            console.error('Error in findEndMeeting:', error)
            return false
        }
    }
}

async function clickWithInnerText(
    page: Page,
    selector: string,
    text: string,
    maxAttempts: number,
    shouldClick: boolean = true,
): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const element = page.locator(`${selector}:has-text("${text}")`)
            if (await element.count() > 0) {
                if (shouldClick) {
                    await element.click()
                }
                return true
            }
        } catch (e) {
            if (i === maxAttempts - 1) {
                console.error(`Error in clickWithInnerText (last attempt):`, e)
            }
        }
        await page.waitForTimeout(100 + i * 100)
    }
    return false
}

async function typeBotName(
    page: Page,
    botName: string,
    maxAttempts: number,
): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const input = page.locator('input[type="text"]')
            if (await input.count() > 0) {
                await input.fill(botName)
                return
            }
        } catch (e) {
            console.error(`Error typing bot name (attempt ${i + 1}):`, e)
        }
        await page.waitForTimeout(100)
    }
    throw new Error('Failed to type bot name')
}

async function tryFindInterface(page: Page): Promise<boolean> {
    try {
        const newInterfaceIndicator = page.locator('div[data-tid="calling-preview"]')
        return await newInterfaceIndicator.count() > 0
    } catch (e) {
        console.error('Error in tryFindInterface:', e)
        return false
    }
}

async function findShowEveryOne(
    page: Page,
    click: boolean,
    cancelCheck: () => boolean,
): Promise<void> {
    let showEveryOneFound = false
    let i = 0

    while (!showEveryOneFound) {
        const button = page.locator('button[title="Show participants"]')
        showEveryOneFound = await button.count() > 0
        if (showEveryOneFound && click) {
            await button.click()
        }

        await Logger.instance.screenshot(page, `findShowEveryone_${i}`)
        console.log({ showEveryOneFound })

        if (cancelCheck()) {
            throw new JoinError(JoinErrorCode.TimeoutWaitingToStart)
        }

        try {
            if (await isBotNotAccepted(page)) {
                console.log('Bot not accepted, exiting meeting')
                throw new JoinError(JoinErrorCode.BotNotAccepted)
            }
        } catch (error) {
            if (error instanceof JoinError) {
                console.log('Caught JoinError, exiting meeting')
                throw error
            }
            console.error('Unexpected error:', error)
        }

        if (!showEveryOneFound) {
            await sleep(1000)
        }
        i++
    }
}

async function isRemovedFromTheMeeting(page: Page): Promise<boolean> {
    try {
        // Vérifie que la page est toujours chargée
        if (!(await ensurePageLoaded(page))) {
            return true
        }
        
        // Vérifie si le bouton "Raise" est présent
        const raiseButton = page.locator('button[title="Raise your hand"]')
        const buttonExists = await raiseButton.count() > 0

        if (!buttonExists) {
            console.log('no raise button found, Bot removed from the meeting')
            return true
        }
        return false
    } catch (error) {
        console.error('Error while checking meeting status:', error)
        return false
    }
}

async function isBotNotAccepted(page: Page): Promise<boolean> {
    const deniedTexts = [
        'Sorry, but you were denied access to the meeting.',
        'Someone in the meeting should let you in soon',
        'Waiting to be admitted',
    ]

    for (const text of deniedTexts) {
        const element = page.locator(`text=${text}`)
        if (await element.count() > 0) {
            return true
        }
    }
    return false
}

async function handlePermissionDialog(page: Page): Promise<void> {
    console.log('handling permission dialog')
    try {
        const okButton = page.locator('button:has-text("OK")')
        if (await okButton.count() > 0) {
            await okButton.click()
            console.log('Permission dialog handled successfully')
        } else {
            console.log('No permission dialog found')
        }
    } catch (error) {
        console.error('Failed to handle permission dialog:', error)
    }
}

async function activateCamera(page: Page): Promise<void> {
    console.log('activating camera')
    try {
        const cameraOffText = page.locator('text="Your camera is turned off"')
        if (await cameraOffText.count() > 0) {
            const cameraButton = page.locator('button[title="Turn camera on"]')
            if (await cameraButton.count() > 0) {
                await cameraButton.click()
                console.log('Camera button clicked successfully')
                await sleep(500)
            } else {
                console.log('Failed to find camera button')
            }
        } else {
            console.log('Camera is already on or text not found')
        }
    } catch (error) {
        console.error('Failed to activate camera:', error)
    }
}

async function ensurePageLoaded(page: Page, timeout = 45000): Promise<boolean> {
    try {
        await page.waitForLoadState('domcontentloaded', { timeout })
        return true
    } catch (error) {
        try {
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
