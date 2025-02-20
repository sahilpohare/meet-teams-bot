import { BrowserContext, Page } from '@playwright/test'
import * as fs from 'fs/promises'


import {
    JoinError,
    JoinErrorCode,
    MeetingParams,
    MeetingProviderInterface,
    RecordingMode
} from '../types'

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

    async parseMeetingUrl( meeting_url: string) {
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
        try {
            console.log('Creating new page in existing context...')
            const page = await browserContext.newPage()
            
            console.log(`Navigating to ${link}...`)
            await page.goto(link, {
                waitUntil: 'networkidle',
                timeout: 30000
            })
            console.log('Navigation completed')
            
            return page
        } catch (error) {
            console.error('openMeetingPage error:', {
                message: (error as Error).message,
                stack: (error as Error).stack,
                name: (error as Error).name
            })
            throw error
        }
    }

    async joinMeeting(
        page: Page,
        cancelCheck: () => boolean,
        meetingParams: MeetingParams,
    ): Promise<void> {
        await clickDismiss(page)
        await sleep(300)

        console.log(
            'useWithoutAccountClicked:',
            await clickWithInnerText(page, 'span', ['Use without an account'], 5),
        )

        await Logger.instance.screenshot(page, `before_typing_bot_name`)
        
        for (let attempt = 1; attempt <= 5; attempt++) {
            if (await typeBotName(page, meetingParams.bot_name)) {
                console.log('Bot name typed at attempt', attempt)
                break
            }
            await Logger.instance.screenshot(page, `bot_name_typing_failed_attempt_${attempt}`)
            await clickOutsideModal(page)
            await page.waitForTimeout(500)
        }

        await Logger.instance.screenshot(page, `after_typing_bot_name`)

        const askToJoinClicked = await clickWithInnerText(page, 'span', ['Ask to join', 'Join now'], 10)
        if (!askToJoinClicked) {
            throw new JoinError(JoinErrorCode.CannotJoinMeeting)
        }

        await findShowEveryOne(page, false, cancelCheck)

        if (meetingParams.enter_message) {
            console.log('Sending entry message...')
            console.log('send message?', await sendEntryMessage(page, meetingParams.enter_message))
            await sleep(100)
        }

        const maxAttempts = 5
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (await changeLayout(page, meetingParams.recording_mode)) {
                console.log(`Layout change successful on attempt ${attempt}`)
                break
            }
            console.log(`Attempt ${attempt} failed`)
            await Logger.instance.screenshot(page, `layout_change_failed_attempt_${attempt}`)
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
        // cancellationToken: CancellationToken,
    ): Promise<boolean> {
        try {
            // Vérifier si la page est gelée
            let isPageFrozen = false
            try {
                await Promise.race([
                    page.evaluate(() => document.readyState),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Page freeze timeout')), 30000)
                    ),
                ])
            } catch (e) {
                console.log('Page appears to be frozen for 30 seconds')
                isPageFrozen = true
            }

            if (isPageFrozen) {
                const frameAnalyzer = FrameAnalyzer.getInstance()
                const framesDir = await frameAnalyzer.getFramesDirectory()
                try {
                    const files = await fs.readdir(framesDir)
                    if (!files.some(file => file.endsWith('.jpg'))) {
                        console.log('Page is frozen and no frames detected')
                        return true
                    }
                } catch (e) {
                    console.log('Failed to read frames directory')
                    return true
                }
            }

            if (!page.isClosed()) {
                const content = await page.content()
                const endMessages = [
                    "You've been removed",
                    'we encountered a problem joining',
                    'The call ended',
                    'Return to home'
                ]
                
                if (endMessages.some(msg => content.includes(msg))) {
                    console.log('End meeting detected through page content')
                    return true
                }
            }

            // OCR Check
            const frameAnalyzer = FrameAnalyzer.getInstance()
            const lastText = frameAnalyzer.getLastFrameText()
            if (lastText?.includes("You've been removed") ||
                lastText?.includes('we encountered a problem joining') ||
                lastText?.includes('The call ended') ||
                lastText?.includes('Return to home')) {
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
    page: Page,
    click: boolean,
    cancelCheck: () => boolean,
) {
    let showEveryOneFound = false
    let i = 0

    while (!showEveryOneFound) {
        const button = page.locator('button[aria-label="Show everyone"], button[aria-label="People"]')
        showEveryOneFound = await button.count() > 0
        if (showEveryOneFound && click) {
            await button.click()
        }

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
            { state: 'visible' }
        )

        const textarea = page.locator('textarea[placeholder="Send a message"], textarea[aria-label="Send a message to everyone"]')
        await textarea.fill(enterMessage)

        const sendButton = page.locator('button:has(i:text("send"))')
        if (await sendButton.count() > 0) {
            await sendButton.click()
            console.log('Clicked on send button')
            await page.click('button[aria-label="Chat with everyone"]')
            return true
        }
        console.log('Send button not found')
        return false
    } catch (error) {
        console.error('Failed to send entry message:', error)
        return false
    }
}

async function notAcceptedInMeeting(page: Page): Promise<boolean> {
    try {
        const deniedTexts = [
            'denied',
            "You've been removed",
            'we encountered a problem joining',
            "You can't join"
        ]

        for (const text of deniedTexts) {
            const element = page.locator(`text=${text}`)
            if (await element.count() > 0) {
                console.log('XXXXXXXXXXXXXXXXXX User has denied entry')
                throw new JoinError(JoinErrorCode.BotNotAccepted)
            }
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

        // Vérifier si "Leave call" est toujours présent
        const leaveCallButton = page.locator('text="Leave call"')
        if (await leaveCallButton.count() > 0) {
            console.log('Leave call found, still in meeting')
            return false
        }

        // Vérifier les messages de fin
        for (const message of REMOVAL_MESSAGES) {
            const element = page.locator(`text="${message}"`)
            if (await element.count() > 0) {
                console.log('Removal message found:', message)
                return true
            }
        }

        return false
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
        const dismissButton = await page.locator('div[role=button]')
            .filter({ hasText: 'Dismiss' })
            .first()
        if (await dismissButton.count() > 0) {
            await dismissButton.click()
            return true
        }
        return false
    } catch (e) {
        console.error('[joinMeeting] meet find dismiss', e)
        return false
    }
}

async function clickWithInnerText(
    page: Page,
    selector: string,
    texts: string[],
    maxAttempts: number,
    shouldClick: boolean = true
): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            for (const text of texts) {
                const element = await page.locator(`${selector}:has-text("${text}")`)
                if (await element.count() > 0) {
                    if (shouldClick) {
                        await element.click()
                    }
                    return true
                }
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

async function changeLayout(
    page: Page,
    recordingMode: RecordingMode,
): Promise<boolean> {
    try {
        const moreVertButton = page.locator('i:text("more_vert")')
        if (!await moreVertButton.click().then(() => true).catch(() => false)) {
            return false
        }
        console.log('more vert clicked')

        const changeLayoutButton = page.locator('span:text("Change layout")')
        if (!await changeLayoutButton.click().then(() => true).catch(() => false)) {
            return false
        }
        console.log('change layout clicked')

        let layoutButton
        if (recordingMode === 'gallery_view') {
            layoutButton = page.locator('span:text("Tiled")')
        } else {
            layoutButton = page.locator('span:text("Spotlight")')
        }

        if (!await layoutButton.click().then(() => true).catch(() => false)) {
            return false
        }
        console.log(`${recordingMode} clicked`)

        await clickOutsideModal(page)
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

        // Effacer le champ de texte existant
        await page.fill(INPUT, '')
        
        // Taper le nouveau nom
        await page.fill(INPUT, BotNameTyped)
        
        // Vérifier que le texte a bien été saisi
        const inputValue = await page.inputValue(INPUT)
        return inputValue.includes(BotNameTyped)
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
