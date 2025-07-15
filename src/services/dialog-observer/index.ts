import type { Page } from '@playwright/test'
import { GLOBAL } from '../../singleton'
import { MeetingContext } from '../../state-machine/types'
import { DialogObserverResult } from './types'
import { tryPatternsWithSmartButtonSearch } from './utils'

/**
 * Ultra-resilient service for detecting and handling blocking modals in Google Meet
 * Supports multiple languages, detection methods, and fallback strategies
 */
export class DialogObserver {
    protected context: MeetingContext
    protected dialogObserverInterval?: NodeJS.Timeout

    constructor(context: MeetingContext) {
        this.context = context
    }

    setupGlobalDialogObserver() {
        // Only start observer for Google Meet
        if (GLOBAL.get().meetingProvider !== 'Meet') {
            console.info(
                `[GlobalDialogObserver] Global dialog observer not started: provider is not Google Meet (${GLOBAL.get().meetingProvider})`,
            )
            return
        }

        // Stop any existing observer
        this.stopGlobalDialogObserver()

        // Start new observer
        this.startGlobalDialogObserver()
    }

    stopGlobalDialogObserver() {
        if (this.dialogObserverInterval) {
            clearInterval(this.dialogObserverInterval)
            this.dialogObserverInterval = undefined
            console.info(
                `[GlobalDialogObserver] Stopped global dialog observer`,
            )
        }
    }

    protected startGlobalDialogObserver() {
        console.info(`[GlobalDialogObserver] Starting global dialog observer`)

        // Observer interval
        this.dialogObserverInterval = setInterval(this.observer, 2000)
    }

    protected observer = async (): Promise<void> => {
        if (!this.context.playwrightPage) {
            console.warn(
                '[GlobalDialogObserver] Cannot start global dialog observer: page not available',
            )
            return
        }

        try {
            if (this.context.playwrightPage?.isClosed()) {
                console.info(
                    `[GlobalDialogObserver] Page closed, stopping observer`,
                )
                this.stopGlobalDialogObserver()
                return
            }

            const result = await this.checkAndDismissModals(
                this.context.playwrightPage,
            )

            if (result.found) {
                console.info(
                    `[GlobalDialogObserver] Modal detection result: ${result.modalType} - ${result.dismissed ? 'dismissed' : 'found but not dismissed'}`,
                )
            }
        } catch (error) {
            console.error(
                `[GlobalDialogObserver] Error checking for dialogs: ${error}`,
            )
        }
    }

    /**
     * Enhanced modal detection with multiple strategies prioritizing resilience
     */
    protected async checkAndDismissModals(
        page: Page,
    ): Promise<DialogObserverResult> {
        try {
            console.log(
                '[GlobalDialogObserver] DEBUG - Starting modal detection sweep...',
            )

            // Try detection methods in order of reliability
            const detectionMethods = [
                () => this.detectSemanticModals(page),
                () => this.detectBehavioralModals(page),
                () => this.detectContentBasedModals(page),
                () => this.detectStructuralModals(page),
            ]

            for (const detectMethod of detectionMethods) {
                const result = await detectMethod()
                if (result.found) {
                    console.log(
                        `[GlobalDialogObserver] Found modal via ${result.detectionMethod}: ${result.modalType}`,
                    )

                    if (result.dismissed) {
                        console.log(
                            `[GlobalDialogObserver] Successfully dismissed modal: ${result.modalType}`,
                        )
                        return result
                    } else {
                        console.log(
                            `[GlobalDialogObserver] Modal found but not dismissed: ${result.modalType}`,
                        )
                        return result
                    }
                }
            }

            return { found: false, dismissed: false, modalType: null }
        } catch (error) {
            console.error(
                '[GlobalDialogObserver] Error during modal detection:',
                error,
            )
            return {
                found: false,
                dismissed: false,
                modalType: 'detection_error',
            }
        }
    }

    /**
     * Strategy 1: Semantic/ARIA detection (most stable - rarely changes)
     */
    protected async detectSemanticModals(
        page: Page,
    ): Promise<DialogObserverResult> {
        const ariaPatterns = [
            {
                name: 'aria_dialog_modal',
                selector: '[role="dialog"][aria-modal="true"]',
                method: 'semantic_aria',
            },
            {
                name: 'aria_alertdialog_modal',
                selector: '[role="alertdialog"]',
                method: 'semantic_aria',
            },
            {
                name: 'modal_attribute_any',
                selector: '[aria-modal="true"]',
                method: 'semantic_aria',
            },
            {
                name: 'dialog_element',
                selector: 'dialog[open]',
                method: 'semantic_html',
            },
        ]

        return await tryPatternsWithSmartButtonSearch(page, ariaPatterns)
    }

    /**
     * Strategy 2: Behavioral detection (structure + interaction patterns)
     */
    protected async detectBehavioralModals(
        page: Page,
    ): Promise<DialogObserverResult> {
        const behavioralPatterns = [
            {
                name: 'overlay_with_dismiss_button',
                selector:
                    'div[style*="position: fixed"]:has(button), div[style*="z-index"]:has(button)',
                method: 'behavioral_overlay',
            },
            {
                name: 'modal_with_backdrop',
                selector: 'div:has(+ div[style*="background"]):has(button)',
                method: 'behavioral_backdrop',
            },
            {
                name: 'centered_card_with_button',
                selector:
                    'div[style*="position: absolute"]:has(img):has(h1, h2, h3):has(button)',
                method: 'behavioral_centered',
            },
            {
                name: 'popup_notification',
                selector: 'div:visible:has(button):has(h1, h2, h3, p)',
                method: 'behavioral_notification',
            },
        ]

        return await tryPatternsWithSmartButtonSearch(page, behavioralPatterns)
    }

    /**
     * Strategy 3: Content-based detection with behavioral triggers
     */
    protected async detectContentBasedModals(
        page: Page,
    ): Promise<DialogObserverResult> {
        const contentPatterns = [
            // Video privacy patterns (multi-language)
            {
                name: 'video_privacy_modal',
                selector:
                    'div:has-text("video differently"), div:has-text("vidéo différemment"), div:has-text("vídeo diferente")',
                method: 'content_video_privacy',
            },
            // Camera/microphone permission patterns
            {
                name: 'camera_permission_modal',
                selector:
                    'div:has-text("camera"), div:has-text("caméra"), div:has-text("cámara"), div:has-text("microfone"), div:has-text("microphone")',
                method: 'content_permissions',
            },
            // Background/feed related content
            {
                name: 'background_feed_modal',
                selector:
                    'div:has-text("background"), div:has-text("arrière-plan"), div:has-text("fundo"), div:has-text("feed")',
                method: 'content_background',
            },
            // Generic privacy/notification content
            {
                name: 'privacy_notification_modal',
                selector:
                    'div:has-text("Others may see"), div:has-text("Les autres"), div:has-text("Otros pueden ver")',
                method: 'content_privacy',
            },
        ]

        // Only consider content patterns that also have dismiss mechanisms
        const enhancedPatterns = contentPatterns.map((pattern) => ({
            ...pattern,
            selector: `${pattern.selector}:has(button), ${pattern.selector} + div:has(button), ${pattern.selector} ~ div:has(button)`,
        }))

        return await tryPatternsWithSmartButtonSearch(page, enhancedPatterns)
    }

    /**
     * Strategy 4: Structural pattern detection
     */
    protected async detectStructuralModals(
        page: Page,
    ): Promise<DialogObserverResult> {
        const patterns = [
            // Modal with header image and text content
            {
                name: 'image_text_modal',
                selector: 'div:has(img):has(h1, h2, h3):has(button)',
                method: 'structural',
            },
            // Modal with specific text patterns about video/camera
            {
                name: 'camera_privacy_modal',
                selector:
                    'div:has-text("vidéo"):has(button), div:has-text("video"):has(button), div:has-text("camera"):has(button)',
                method: 'structural',
            },
            // Modal with background/feed related content
            {
                name: 'background_feed_modal',
                selector:
                    'div:has-text("arrière-plan"):has(button), div:has-text("background"):has(button), div:has-text("feed"):has(button)',
                method: 'structural',
            },
        ]

        return await tryPatternsWithSmartButtonSearch(page, patterns)
    }
}
