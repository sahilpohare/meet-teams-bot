import { BrowserContext, Page } from '@playwright/test'

import {
    JoinError,
    JoinErrorCode,
    MeetingParams,
    MeetingProviderInterface
} from '../types'

import { parseMeetingUrlFromJoinInfos } from '../urlParser/meetUrlParser'
import { sleep } from '../utils'
import { takeScreenshot } from '../utils/takeScreenshot'
import { closeMeeting } from './meet/closeMeeting'

export class MeetProvider implements MeetingProviderInterface {
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
        try {
            console.log('Creating new page in existing context...')
            const page = await browserContext.newPage()

            // Set permissions based on streaming_input
            if (streaming_input) {
                await browserContext.grantPermissions(['microphone', 'camera'])
            } else {
                await browserContext.grantPermissions(['camera'])
            }

            console.log(`Navigating to ${link}...`)
            await page.goto(link, {
                waitUntil: 'networkidle',
                timeout: 30000,
            })
            console.log('Navigation completed')

            return page
        } catch (error) {
            console.error('openMeetingPage error:', {
                message: (error as Error).message,
                stack: (error as Error).stack,
                name: (error as Error).name,
            })
            throw error
        }
    }

    async joinMeeting(
        page: Page,
        cancelCheck: () => boolean,
        meetingParams: MeetingParams,
    ): Promise<void> {
        try {
            await clickDismiss(page)
            await sleep(300)

            console.log(
                'useWithoutAccountClicked:',
                await clickWithInnerText(
                    page,
                    'span',
                    ['Use without an account'],
                    5,
                ),
            )

            await takeScreenshot(page, `before_typing_bot_name`)

            for (let attempt = 1; attempt <= 5; attempt++) {
                if (await typeBotName(page, meetingParams.bot_name)) {
                    console.log('Bot name typed at attempt', attempt)
                    break
                }
                await takeScreenshot(
                    page,
                    `bot_name_typing_failed_attempt_${attempt}`,
                )
                await clickOutsideModal(page)
                await page.waitForTimeout(500)
            }

            await takeScreenshot(page, `after_typing_bot_name`)

            // Control microphone based on streaming_input
            if (meetingParams.streaming_input) {
                await activateMicrophone(page)
            } else {
                await deactivateMicrophone(page)
            }

            await takeScreenshot(page, `before_join_button_attempts`);

            // Try multiple approaches to find the join button
            let askToJoinClicked = await clickWithInnerText(
                page,
                'span',
                ['Ask to join', 'Join now'],
                5,
            );

            if (!askToJoinClicked) {
                console.log('First attempt to find join button failed, trying alternate selectors');
                
                // Try button element directly
                askToJoinClicked = await clickWithInnerText(
                    page,
                    'button',
                    ['Ask to join', 'Join now', 'Join meeting', 'Join', 'Enter meeting'],
                    5,
                );
            }

            if (!askToJoinClicked) {
                console.log('Second attempt failed, trying by aria-label');
                
                // Try by aria-label which might be more stable
                try {
                    const joinButtons = page.locator('button[aria-label*="Join"], button[aria-label*="join now"]');
                    const count = await joinButtons.count();
                    console.log(`Found ${count} buttons with Join in aria-label`);
                    
                    if (count > 0) {
                        await joinButtons.first().click();
                        console.log('Clicked join button by aria-label');
                        askToJoinClicked = true;
                    }
                } catch (e) {
                    console.error('Error trying to click by aria-label:', e);
                }
            }

            if (!askToJoinClicked) {
                // Take a screenshot to see what the UI looks like at failure
                await takeScreenshot(page, `join_button_not_found`);
                throw new JoinError(JoinErrorCode.CannotJoinMeeting);
            }

            // Attendre un peu après avoir rejoint avant de chercher le dialog
            await page.waitForTimeout(2000);
            
            // Essayer plusieurs fois de fermer le dialog
            for (let i = 0; i < 3; i++) {
                if (await dismissGotItDialog(page)) {
                    console.log('Successfully dismissed Got it dialog');
                    break;
                }
                await page.waitForTimeout(1000);
            }

            await findShowEveryOne(page, false, cancelCheck)

            // Essayer de fermer le dialog avant tout
            await dismissGotItDialog(page);

            if (meetingParams.enter_message) {
                console.log('Sending entry message...')
                console.log(
                    'send message?',
                    await sendEntryMessage(page, meetingParams.enter_message),
                )
                await sleep(100)
            }

            await clickOutsideModal(page)
            const maxAttempts = 5
            if (meetingParams.recording_mode !== 'audio_only') {
                for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                    if (await changeLayout(page, attempt)) {
                        console.log(`Layout change successful on attempt ${attempt}`)
                        break
                    }
                    console.log(`Attempt ${attempt} failed`)
                    await takeScreenshot(page, `layout_change_failed_attempt_${attempt}`)
                    await clickOutsideModal(page)
                    await page.waitForTimeout(500)
                }
            }

            if (meetingParams.recording_mode !== 'gallery_view') {
                await findShowEveryOne(page, true, cancelCheck)
            }

        } catch (error) {
            console.error('Error in joinMeeting:', {
                message: (error as Error).message,
                stack: (error as Error).stack
            });
            
            // On continue le meeting même en cas d'erreur
            console.log('Continuing meeting despite error...');
        }
    }

    async findEndMeeting(
        meetingParams: MeetingParams,
        page: Page,
        // cancellationToken: CancellationToken,
    ): Promise<boolean> {
        try {
            try {
                await Promise.race([
                    page.evaluate(() => document.readyState),
                    new Promise((_, reject) =>
                        setTimeout(
                            () => reject(new Error('Page freeze timeout')),
                            20000,
                        ),
                    ),
                ])
            } catch (e) {
                console.log('Page appears to be frozen for 30 seconds')
                return true
            }

            if (!page.isClosed()) {
                const content = await page.content()
                const endMessages = [
                    "You've been removed",
                    'we encountered a problem joining',
                    'The call ended',
                    'Return to home',
                    'No one else',
                ]

                if (endMessages.some((msg) => content.includes(msg))) {
                    console.log('End meeting detected through page content')
                    return true
                }
            }
            return false
        } catch (error) {
            console.error('Error in findEndMeeting:', error)
            return false
        }
    }

    async closeMeeting(page: Page): Promise<void> {
        await closeMeeting(page)
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
        // On cible le bouton dans la nav principale, en utilisant des attributs stables
        const buttons = page.locator(
            [
                'nav button[aria-label="People"][role="button"]',
                'nav button[aria-label="Show everyone"][role="button"]',
                // Le data-panel-id="1" semble être un identifiant stable pour le panneau des participants
                'nav button[data-panel-id="1"][role="button"]',
            ].join(', ')
        )
        
        const count = await buttons.count()
        showEveryOneFound = count > 0

        if (showEveryOneFound && click) {
            try {
                await buttons.first().click()
                console.log('Successfully clicked People button')
            } catch (e) {
                console.log('Failed to click People button:', e)
                showEveryOneFound = false
            }
        }

        await takeScreenshot(page, `findShowEveryone`)
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
            { state: 'visible' },
        )

        const textarea = page.locator(
            'textarea[placeholder="Send a message"], textarea[aria-label="Send a message to everyone"]',
        )
        await textarea.fill(enterMessage)

        const sendButton = page.locator('button:has(i:text("send"))')
        if ((await sendButton.count()) > 0) {
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
            "You can't join",
        ]

        for (const text of deniedTexts) {
            const element = page.locator(`text=${text}`)
            if ((await element.count()) > 0) {
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

async function clickDismiss(page: Page): Promise<boolean> {
    try {
        const dismissButton = await page
            .locator('div[role=button]')
            .filter({ hasText: 'Dismiss' })
            .first()
        if ((await dismissButton.count()) > 0) {
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
    shouldClick: boolean = true,
): Promise<boolean> {
    console.log(`Attempting to find ${selector} with texts: ${texts.join(', ')}`)
    
    // First, take a screenshot to see what the page looks like
    await takeScreenshot(page, `before_click_${texts.join('_')}_attempt`)
    
    for (let i = 0; i < maxAttempts; i++) {
        try {
            // Dump the page content to log for analysis
            if (i === 0) {
                console.log('Page content preview:', await page.content().then(c => c.slice(0, 500) + '...'))
                
                // Log visible buttons for debugging
                const visibleButtons = await page.evaluate(() => {
                    return Array.from(document.querySelectorAll('button, span[role="button"]'))
                        .filter(el => {
                            const style = window.getComputedStyle(el);
                            return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
                        })
                        .map(el => ({
                            text: el.textContent?.trim(),
                            role: el.getAttribute('role'),
                            ariaLabel: el.getAttribute('aria-label')
                        }));
                });
                console.log('Visible buttons:', JSON.stringify(visibleButtons, null, 2));
            }
            
            for (const text of texts) {
                console.log(`Attempt ${i+1}/${maxAttempts} - Looking for "${text}" in ${selector}`)
                
                // Try multiple selector strategies
                const selectors = [
                    `${selector}:has-text("${text}")`,
                    `${selector}:text-is("${text}")`,
                    `${selector}[aria-label*="${text}"]`,
                    `button:has(${selector}:has-text("${text}"))`
                ];
                
                for (const sel of selectors) {
                    const element = page.locator(sel);
                    const count = await element.count();
                    console.log(`  - Selector "${sel}" found ${count} elements`);
                    
                    if (count > 0) {
                        console.log(`  - Found element with text "${text}" using selector "${sel}"`);
                        if (shouldClick) {
                            // Take screenshot before clicking
                            await takeScreenshot(page, `before_click_${text.replace(/\s+/g, '_')}`);
                            await element.click();
                            console.log(`  - Clicked on element with text "${text}"`);
                            await takeScreenshot(page, `after_click_${text.replace(/\s+/g, '_')}`);
                        }
                        return true;
                    }
                }
            }
        } catch (e) {
            console.error(`Error in clickWithInnerText (attempt ${i+1}/${maxAttempts}):`, e);
        }
        await page.waitForTimeout(100 + i * 100);
    }
    
    // Take a final screenshot to see what the page looks like after all attempts
    await takeScreenshot(page, `failed_click_${texts.join('_')}_final`);
    
    // Log all visible text on the page as a last resort
    console.log('All visible text on page:', await page.evaluate(() => {
        return document.body.innerText.slice(0, 1000) + '...';
    }));
    
    return false;
}

async function changeLayout(page: Page, currentAttempt = 1, maxAttempts = 3): Promise<boolean> {
    console.log(`Starting layout change process (attempt ${currentAttempt}/${maxAttempts})...`);
    
    try {
        await page.waitForLoadState('networkidle');
        
        // 1. Cliquer sur le bouton "More options"
        console.log('Looking for More options button in call controls...');
        const moreOptionsButton = page.locator('div[role="region"][aria-label="Call controls"] button[aria-label="More options"]');
        await moreOptionsButton.waitFor({ state: 'visible', timeout: 5000 });
        await moreOptionsButton.click();
        await page.waitForTimeout(1000);
        
        // 2. Cliquer sur "Change layout"
        console.log('Looking for Change layout menu item...');
        const changeLayoutItem = page.locator('[role="menu"] [role="menuitem"]:has(span:has-text("Change layout"))');
        await changeLayoutItem.waitFor({ state: 'visible', timeout: 5000 });
        await changeLayoutItem.click();
        await page.waitForTimeout(1000);

        // 3. Cliquer sur "Spotlight"
        console.log('Looking for Spotlight option...');
        const spotlightOption = page.locator([
            // Plusieurs sélecteurs pour plus de résilience
            'label:has-text("Spotlight"):has(input[type="radio"])',
            'label:has(input[name="preferences"]):has-text("Spotlight")',
            'label:has(span:text-is("Spotlight"))',
        ].join(','));

        // Ajouter des logs pour le debug
        const count = await spotlightOption.count();
        console.log(`Found ${count} Spotlight options`);

        await spotlightOption.waitFor({ state: 'visible', timeout: 5000 });
        console.log('Clicking Spotlight option...');
        await spotlightOption.click();
        await page.waitForTimeout(1000);
        await clickOutsideModal(page)
        return true;

    } catch (error) {
        console.error(`Error in changeLayout attempt ${currentAttempt}:`, {
            message: (error as Error).message,
            stack: (error as Error).stack
        });
        
        // Prendre une capture d'écran en cas d'erreur
        await page.screenshot({ path: `error-layout-change-${currentAttempt}.png` });
        
        if (currentAttempt < maxAttempts) {
            console.log(`Retrying layout change (attempt ${currentAttempt + 1}/${maxAttempts})...`);
            await page.waitForTimeout(2000);
            return changeLayout(page, currentAttempt + 1, maxAttempts);
        }
        return false;
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

async function activateMicrophone(page: Page): Promise<boolean> {
    console.log('Activating microphone...')
    try {
        // Look for the microphone button that's turned off
        const microphoneButton = page.locator(
            'div[aria-label="Turn on microphone"]',
        )
        if ((await microphoneButton.count()) > 0) {
            await microphoneButton.click()
            console.log('Microphone activated successfully')
            return true
        } else {
            console.log('Microphone is already active or button not found')
            return false
        }
    } catch (error) {
        console.error('Error activating microphone:', error)
        return false
    }
}

async function deactivateMicrophone(page: Page): Promise<boolean> {
    console.log('Deactivating microphone...')
    try {
        // Look for the microphone button that's turned on
        const microphoneButton = page.locator(
            'div[aria-label="Turn off microphone"]',
        )
        if ((await microphoneButton.count()) > 0) {
            await microphoneButton.click()
            console.log('Microphone deactivated successfully')
            return true
        } else {
            console.log('Microphone is already deactivated or button not found')
            return false
        }
    } catch (error) {
        console.error('Error deactivating microphone:', error)
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

async function dismissGotItDialog(page: Page): Promise<boolean> {
    try {
        console.log('Looking for "Got it" dialog...');
        
        // Vérification rapide de la présence du dialog (500ms)
        const dialog = page.locator('[role="dialog"][aria-modal="true"][aria-label="Others may see your video differently"]');
        const isDialogVisible = await dialog.isVisible({ timeout: 500 })
            .catch(() => false);

        if (!isDialogVisible) {
            console.log('No video visibility dialog found');
            return false;
        }

        console.log('Found dialog about video visibility');
        const gotItButton = dialog.locator('button:has-text("Got it")');
        
        // Si le dialog est visible, on clique
        await gotItButton.click({ timeout: 1000 });
        console.log('Clicked Got it button');
        
        // Vérification rapide que le dialog a disparu
        await dialog.waitFor({ state: 'hidden', timeout: 1000 })
            .catch(() => console.log('Dialog might still be visible'));
        
        return true;

    } catch (error) {
        console.log('Error handling Got it dialog:', error);
        return false;
    }
}
