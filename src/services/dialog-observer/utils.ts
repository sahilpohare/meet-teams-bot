import { Page } from '@playwright/test'
import { DialogObserverResult } from './types'
import { LanguagePatterns } from './language-patterns'

const TIMEOUTS = {
    VISIBLE_TIMEOUT: 300,
    CLICK_TIMEOUT: 500,
    PAGE_TIMEOUT: 1000,
    LOCATOR_TIMEOUT: 500,
}

/**
 * Smart button search - tries multiple scopes and patterns
 */
export async function tryPatternsWithSmartButtonSearch(
    page: Page,
    patterns: Array<{ name: string; selector: string; method: string }>,
    customTimeout: number = 0,
    retryCheckAndDismissModals: () => Promise<void> = () => Promise.resolve(),
): Promise<DialogObserverResult> {
    const timeouts =
        customTimeout === 0
            ? TIMEOUTS
            : {
                  VISIBLE_TIMEOUT: customTimeout,
                  CLICK_TIMEOUT: customTimeout,
                  PAGE_TIMEOUT: customTimeout,
                  LOCATOR_TIMEOUT: customTimeout,
              }

    for (const pattern of patterns) {
        try {
            const modal = page.locator(pattern.selector)
            const isVisible = await modal.isVisible({
                timeout: timeouts.VISIBLE_TIMEOUT,
            })

            if (isVisible) {
                console.info(
                    `[GlobalDialogObserverUtils] Found modal via ${pattern.method}: ${pattern.name}`,
                )

                // Log modal text content for debugging
                try {
                    const modalFullText =
                        (await modal.textContent({
                            timeout: timeouts.LOCATOR_TIMEOUT,
                        })) || ''
                    const cleanText = modalFullText
                        .trim()
                        .replace(/\s+/g, ' ')
                        .substring(0, 250)
                    console.log(
                        `[GlobalDialogObserverUtils] Modal text: "${cleanText}${modalFullText.length > 250 ? '...' : ''}"`,
                    )
                } catch (textError) {
                    console.warn(
                        `[GlobalDialogObserverUtils] Could not retrieve modal text content: ${textError}`,
                    )
                }

                // Try multiple button search strategies
                const buttonSearchStrategies = [
                    { scope: modal, name: 'inside modal' },
                    {
                        scope: modal.locator('..'),
                        name: 'parent container',
                    },
                    {
                        scope: modal.locator('../..'),
                        name: 'grandparent container',
                    },
                    { scope: page, name: 'entire page' },
                ]

                for (const searchStrategy of buttonSearchStrategies) {
                    try {
                        const result = await dismissWithUniversalButtonSearch(
                            page,
                            searchStrategy.scope,
                            pattern.name,
                            searchStrategy.name,
                            customTimeout,
                            retryCheckAndDismissModals,
                        )
                        if (result.dismissed) {
                            return {
                                ...result,
                                detectionMethod: pattern.method,
                            }
                        }
                    } catch (searchError) {
                        console.warn(
                            `[GlobalDialogObserverUtils] Search strategy "${searchStrategy.name}" failed: ${searchError}`,
                        )
                        continue
                    }
                }

                return {
                    found: true,
                    dismissed: false,
                    modalType: pattern.name,
                    detectionMethod: pattern.method,
                }
            }
        } catch (error) {
            continue
        }
    }

    return { found: false, dismissed: false, modalType: null }
}

/**
 * Universal button search with multiple patterns and behaviors
 */
export async function dismissWithUniversalButtonSearch(
    page: Page,
    searchScope: any,
    modalType: string,
    scopeName: string,
    customTimeout: number = 0,
    retryCheckAndDismissModals: () => Promise<void> = () => Promise.resolve(),
): Promise<DialogObserverResult> {
    const timeouts =
        customTimeout === 0
            ? TIMEOUTS
            : {
                  VISIBLE_TIMEOUT: customTimeout,
                  CLICK_TIMEOUT: customTimeout,
                  PAGE_TIMEOUT: customTimeout,
                  LOCATOR_TIMEOUT: customTimeout,
              }

    console.info(
        `[GlobalDialogObserver] Trying universal button search in: ${scopeName}`,
    )

    // Universal button detection patterns (not dependent on specific classes)
    const buttonPatterns = [
        // Semantic buttons
        'button[aria-label*="close"], button[aria-label*="dismiss"], button[aria-label*="ok"]',
        // Data attributes
        'button[data-action*="close"], button[data-action*="dismiss"], button[data-action*="ok"]',
        // Type attributes
        'button[type="button"], input[type="button"], input[type="submit"]',
        // Generic interactive elements
        'button, [role="button"], [tabindex="0"][onclick]',
        // Links that might act as buttons
        'a[href="#"], a[onclick]',
    ]

    for (const buttonPattern of buttonPatterns) {
        try {
            const buttons = searchScope.locator(buttonPattern)
            const buttonCount = await buttons.count()

            if (buttonCount > 0) {
                console.info(
                    `[GlobalDialogObserver] Found ${buttonCount} buttons with pattern: ${buttonPattern}`,
                )

                // Try clicking visible buttons
                for (let i = 0; i < buttonCount; i++) {
                    try {
                        const button = buttons.nth(i)
                        const isVisible = await button.isVisible({
                            timeout: timeouts.VISIBLE_TIMEOUT,
                        })

                        if (isVisible) {
                            // Check if button looks like a dismiss button
                            const buttonText = await button
                                .textContent({
                                    timeout: timeouts.LOCATOR_TIMEOUT,
                                })
                                .catch(() => {
                                    // The button is visible but we couldn't get the text, retry
                                    retryCheckAndDismissModals()
                                })
                            const ariaLabel = await button
                                .getAttribute('aria-label')
                                .catch(() => {
                                    // The button is visible but we couldn't get the aria-label, retry
                                    retryCheckAndDismissModals()
                                })

                            const dismissIndicators = [
                                'ok',
                                'got it',
                                'dismiss',
                                'close',
                                'fermer',
                                'compris',
                                'entendido',
                                'verstanden',
                                'capito',
                                'begrepen',
                                '×',
                                '✕',
                            ]

                            const textToCheck =
                                `${buttonText} ${ariaLabel}`.toLowerCase()
                            const looksLikeDismiss = dismissIndicators.some(
                                (indicator) =>
                                    textToCheck.includes(
                                        indicator.toLowerCase(),
                                    ),
                            )

                            if (looksLikeDismiss || buttonCount === 1) {
                                // Single button likely dismisses
                                console.info(
                                    `[GlobalDialogObserver] Attempting click on button: "${buttonText}" (${ariaLabel})`,
                                )
                                await button.click({
                                    timeout: timeouts.VISIBLE_TIMEOUT,
                                })
                                await page.waitForTimeout(timeouts.PAGE_TIMEOUT)

                                return {
                                    found: true,
                                    dismissed: true,
                                    modalType: modalType,
                                    language:
                                        LanguagePatterns.detectLanguage(
                                            textToCheck,
                                        ),
                                }
                            }
                        }
                    } catch (buttonError) {
                        continue
                    }
                }
            }
        } catch (patternError) {
            continue
        }
    }

    // Fallback to text-based search
    return await dismissWithTextButtons(
        page,
        searchScope,
        modalType,
        customTimeout,
        retryCheckAndDismissModals,
    )
}

/**
 * Enhanced button dismissal with multi-language support
 */
export async function dismissWithTextButtons(
    page: Page,
    modal: any,
    modalType: string,
    customTimeout: number = 0,
    retryCheckAndDismissModals: () => Promise<void> = () => Promise.resolve(),
): Promise<DialogObserverResult> {
    const timeouts =
        customTimeout === 0
            ? TIMEOUTS
            : {
                  VISIBLE_TIMEOUT: customTimeout,
                  CLICK_TIMEOUT: customTimeout,
                  PAGE_TIMEOUT: customTimeout,
                  LOCATOR_TIMEOUT: customTimeout,
              }

    const buttonTexts = LanguagePatterns.getAllButtonTexts()

    // Try each button text pattern
    for (const buttonText of buttonTexts) {
        try {
            // Try exact text match first
            let button = modal.locator(`button:has-text("${buttonText}")`)
            let buttonCount = await button.count()

            if (
                buttonCount > 0 &&
                (await button
                    .first()
                    .isVisible({ timeout: timeouts.VISIBLE_TIMEOUT }))
            ) {
                console.info(
                    `[GlobalDialogObserver] DEBUG - Attempting click on exact text button: "${buttonText}"`,
                )
                await button
                    .first()
                    .click({
                        timeout: timeouts.CLICK_TIMEOUT,
                    })
                    .catch(() => {
                        // The button is visible but we couldn't click it, retry
                        retryCheckAndDismissModals()
                    })
                await page.waitForTimeout(timeouts.PAGE_TIMEOUT)
                console.info(
                    `[GlobalDialogObserver] DEBUG - Successfully dismissed ${modalType} with exact text: "${buttonText}"`,
                )
                return {
                    found: true,
                    dismissed: true,
                    modalType: modalType,
                    language: LanguagePatterns.detectLanguage(buttonText),
                }
            }

            // Try partial text match
            button = modal.locator(
                `button:text-matches(".*${buttonText}.*", "i")`,
            )
            buttonCount = await button.count()

            if (
                buttonCount > 0 &&
                (await button
                    .first()
                    .isVisible({ timeout: timeouts.VISIBLE_TIMEOUT }))
            ) {
                console.info(
                    `[GlobalDialogObserver] DEBUG - Attempting click on partial text button: "${buttonText}"`,
                )
                await button
                    .first()
                    .click({
                        timeout: timeouts.CLICK_TIMEOUT,
                    })
                    .catch(() => {
                        // The button is visible but we couldn't click it, retry
                        retryCheckAndDismissModals()
                    })
                await page.waitForTimeout(timeouts.PAGE_TIMEOUT)
                console.info(
                    `[GlobalDialogObserver] DEBUG - Successfully dismissed ${modalType} with partial text: "${buttonText}"`,
                )
                return {
                    found: true,
                    dismissed: true,
                    modalType: modalType,
                    language: LanguagePatterns.detectLanguage(buttonText),
                }
            }

            // Try by span content (for Material Design buttons)
            button = modal.locator(`button span:has-text("${buttonText}")`)
            buttonCount = await button.count()

            if (
                buttonCount > 0 &&
                (await button
                    .first()
                    .isVisible({ timeout: timeouts.VISIBLE_TIMEOUT }))
            ) {
                console.info(
                    `[GlobalDialogObserver] DEBUG - Attempting click on span text button: "${buttonText}"`,
                )
                await button
                    .first()
                    .click({ timeout: timeouts.CLICK_TIMEOUT })
                    .catch(() => {
                        // The button is visible but we couldn't click it, retry
                        retryCheckAndDismissModals()
                    })
                await page.waitForTimeout(timeouts.PAGE_TIMEOUT)
                console.info(
                    `[GlobalDialogObserver] DEBUG - Successfully dismissed ${modalType} with span text: "${buttonText}"`,
                )
                return {
                    found: true,
                    dismissed: true,
                    modalType: modalType,
                    language: LanguagePatterns.detectLanguage(buttonText),
                }
            }
        } catch (error) {
            console.warn(
                `[GlobalDialogObserver] DEBUG - Error trying button text "${buttonText}": ${error}`,
            )
            continue
        }
    }

    console.warn(
        `[GlobalDialogObserver] DEBUG - Failed to dismiss ${modalType} with any text pattern`,
    )
    return { found: true, dismissed: false, modalType: modalType }
}
