import { Page } from '@playwright/test'

export async function closeMeeting(page: Page): Promise<void> {
    try {
        console.log('Attempting to close meeting...')

        // Try multiple selectors for the leave call button
        const leaveCallSelectors = [
            'button[aria-label="Leave call"]',
            'button[data-tooltip-id*="tt"][aria-label="Leave call"]',
            'div[jsname="CQylAd"][aria-label="Leave call"]',
            'button.VYBDae-Bz112c-LgbsSe[aria-label="Leave call"]',
        ]

        let buttonFound = false
        for (const selector of leaveCallSelectors) {
            const leaveButton = page.locator(selector)
            if ((await leaveButton.count()) > 0) {
                await leaveButton.click({ timeout: 3000 })
                console.log(
                    `Successfully clicked Leave call button using selector: ${selector}`,
                )
                buttonFound = true
                break
            }
        }

        if (!buttonFound) {
            // Try clicking on the red hang up button by its color and icon
            console.log('Trying to find leave button by icon...')
            const iconButton = page.locator(
                'button span[jsname="S5tZuc"] i:has-text("call_end")',
            )
            if ((await iconButton.count()) > 0) {
                await iconButton.click({ force: true })
                console.log('Clicked on call_end icon')
                buttonFound = true
            }
        }

        // Wait a moment for the meeting to close
        await page.waitForTimeout(2000)

        // Check if there's a confirmation dialog and click "Leave"
        const leaveConfirmSelectors = [
            'button:has-text("Leave")',
            'button:has-text("Exit")',
            'button:has-text("Quit")',
        ]

        for (const selector of leaveConfirmSelectors) {
            const confirmButton = page.locator(selector).first()
            if ((await confirmButton.count()) > 0) {
                await confirmButton.click()
                console.log(
                    `Clicked confirmation button with selector: ${selector}`,
                )
                break
            }
        }

        console.log('Meeting close sequence completed')
    } catch (error) {
        console.error('Error closing meeting:', error)

        // Try alternative methods if the button click fails
        try {
            console.log('Trying alternative methods to close the meeting...')

            // Try to close using keyboard shortcut (Ctrl+W)
            await page.keyboard.press('Control+w')
            console.log('Attempted to close meeting using keyboard shortcut')

            // If still open, try to navigate away
            if (!page.isClosed()) {
                await page.goto('about:blank')
                console.log('Navigated away from meeting page')
            }
        } catch (e) {
            console.error(
                'Failed to close meeting with alternative methods:',
                e,
            )
        }
    }
}
