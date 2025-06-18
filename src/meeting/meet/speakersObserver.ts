import { Page } from '@playwright/test'
import { RecordingMode, SpeakerData } from '../../types'

export const SPEAKER_LATENCY = 1500 // ms - same as extension

export class MeetSpeakersObserver {
    private page: Page
    private isObserving: boolean = false
    private lastSpeakers: Map<string, boolean> = new Map()
    private recordingMode: RecordingMode
    private botName: string
    private onSpeakersChange: (speakers: SpeakerData[]) => void

    constructor(
        page: Page,
        recordingMode: RecordingMode,
        botName: string,
        onSpeakersChange: (speakers: SpeakerData[]) => void,
    ) {
        this.page = page
        this.recordingMode = recordingMode
        this.botName = botName
        this.onSpeakersChange = onSpeakersChange
    }

    public async startObserving(): Promise<void> {
        if (this.isObserving) {
            console.warn('[Meet] Speakers observer already running')
            return
        }

        console.log('[Meet] Starting speakers observation...')
        this.isObserving = true

        // Expose callback function to the page
        await this.page.exposeFunction('meetSpeakersChanged', async (speakers: SpeakerData[]) => {
            try {
                console.log(`[Meet] Browser callback: ${speakers.length} speakers`)
                // Filter out bot - same as extension
                const filteredSpeakers = speakers.filter(
                    (speaker) => speaker.name !== this.botName,
                )

                // Check if speakers have changed - exactly same logic as extension
                const newSpeakers = new Map(
                    filteredSpeakers.map((elem) => [elem.name, elem.isSpeaking]),
                )

                if (!this.areMapsEqual(this.lastSpeakers, newSpeakers)) {
                    console.log(`[Meet] 🎤 SPEAKERS CHANGED: ${filteredSpeakers.length} participants`)
                    this.onSpeakersChange(filteredSpeakers)
                    this.lastSpeakers = newSpeakers
                }
            } catch (error) {
                console.error('[Meet] Error in speakers callback:', error)
            }
        })

        // Initialize the observer in the browser context - EXACT SAME AS EXTENSION
        console.log('[Meet] Setting up browser-side observer...')
        await this.setupBrowserObserver()

        console.log('[Meet] Speakers observer started successfully')
    }

    public stopObserving(): void {
        if (!this.isObserving) {
            return
        }

        console.log('[Meet] Stopping speakers observer...')
        this.isObserving = false

        // Stop browser-side observer
        this.page.evaluate(() => {
            if ((window as any).meetObserverCleanup) {
                (window as any).meetObserverCleanup()
            }
        }).catch(e => console.error('[Meet] Error cleaning up browser observer:', e))

        console.log('[Meet] Speakers observer stopped')
    }

    private async setupBrowserObserver(): Promise<void> {
        try {
            console.log('[Meet] Setting up browser-side observer - EXACT EXTENSION LOGIC...')
            
            await this.page.evaluate(
                ({ recordingMode, botName, speakerLatency }) => {
                    // Cleanup existing observer
                    if ((window as any).meetObserverCleanup) {
                        (window as any).meetObserverCleanup()
                    }

                    console.log('[Meet-Browser] Setting up observation - EXACT EXTENSION LOGIC')

                    // EXACT SAME VARIABLES AS EXTENSION (global scope like extension)
                    let CUR_SPEAKERS = new Map<string, boolean>()
                    let checkSpeakersTimeout: number | null = null
                    const MUTATION_DEBOUNCE = 150 // EXACT SAME AS EXTENSION - 150ms NOT 1000ms!
                    let lastMutationTime = Date.now()
                    let MUTATION_OBSERVER: MutationObserver | null = null

                    // EXACT SAME helper functions as extension
                    function getSpeakerRootToObserve(recordingMode: string): Promise<[Node, MutationObserverInit] | undefined> {
                        return new Promise((resolve) => {
                            // EXACT SAME logic as extension
                            const waitForElement = (selector: string, maxAttempts: number = 50): Promise<Element | null> => {
                                return new Promise((resolve) => {
                                    let attempts = 0
                                    const checkElement = () => {
                                        const element = document.querySelector(selector)
                                        if (element || attempts >= maxAttempts) {
                                            resolve(element)
                                        } else {
                                            attempts++
                                            setTimeout(checkElement, 100)
                                        }
                                    }
                                    checkElement()
                                })
                            }

                            // Wait for the specific element based on recording mode - EXACT SAME AS EXTENSION
                            let selector: string
                            if (recordingMode === 'gallery_view') {
                                selector = '[role="main"] [data-self-name]'
                            } else {
                                selector = '[role="main"] [data-self-name], [role="main"] [data-participant-id]'
                            }

                            waitForElement(selector).then((element) => {
                                if (element) {
                                    // Find the appropriate container - EXACT SAME AS EXTENSION
                                    let container = element.closest('[role="main"]')
                                    if (!container) {
                                        container = document.querySelector('[role="main"]')
                                    }
                                    if (!container) {
                                        container = document.documentElement
                                    }

                                    resolve([
                                        container,
                                        {
                                            attributes: true,
                                            childList: true,
                                            subtree: true,
                                            attributeFilter: ['data-self-name', 'data-participant-id', 'style', 'class']
                                        }
                                    ])
                                } else {
                                    // Fallback to document - EXACT SAME AS EXTENSION
                                    resolve([
                                        document.documentElement,
                                        {
                                            attributes: true,
                                            childList: true,
                                            subtree: true,
                                            attributeFilter: ['data-self-name', 'data-participant-id', 'style', 'class']
                                        }
                                    ])
                                }
                            })
                        })
                    }

                    function extractName(element: Element): string {
                        try {
                            // EXACT SAME logic as extension
                            const ariaLabel = element.getAttribute('aria-label') || ''
                            
                            // Split on common separators and take the first part
                            const separators = [',', '(', ' is ', ' joined', ' left', 'presenting']
                            let name = ariaLabel
                            
                            for (const separator of separators) {
                                if (name.includes(separator)) {
                                    name = name.split(separator)[0].trim()
                                    break
                                }
                            }
                            
                            return name || ''
                        } catch (e) {
                            return ''
                        }
                    }

                    function isSpeaking(element: Element): boolean {
                        try {
                            // EXACT SAME logic as extension - Check for speaking indicators
                            
                            // Method 1: Check for speaking ring animation
                            const speakingRing = element.querySelector('[data-is-speaking="true"], [data-speaking="true"]')
                            if (speakingRing) {
                                return true
                            }

                            // Method 2: Check for animated elements that indicate speaking
                            const animatedElements = element.querySelectorAll('[style*="animation"], [class*="speaking"], [class*="active"]')
                            for (const animEl of animatedElements) {
                                const style = window.getComputedStyle(animEl)
                                if (style.animationName && style.animationName !== 'none') {
                                    return true
                                }
                            }

                            // Method 3: Check for specific Google Meet speaking indicators
                            const voiceIndicator = element.querySelector('[data-self-name] + div[style*="background"], [data-participant-id] + div[style*="background"]')
                            if (voiceIndicator) {
                                const style = window.getComputedStyle(voiceIndicator)
                                // Check for blue-ish colors typically used for speaking indicators
                                const bgColor = style.backgroundColor
                                if (bgColor.includes('rgb') && bgColor.includes('54, 179, 126')) { // Green speaking indicator
                                    return true
                                }
                            }

                            return false
                        } catch (e) {
                            return false
                        }
                    }

                    // EXACT SAME getSpeakerFromDocument as extension
                    function getSpeakerFromDocument(recordingMode: string, timestamp: number): any[] {
                        try {
                            const speakers: any[] = []

                            // Find all participant elements - EXACT SAME AS EXTENSION
                            const participantSelectors = [
                                '[data-self-name]',
                                '[data-participant-id]',
                                '[role="main"] [aria-label*="microphone"], [role="main"] [aria-label*="camera"]'
                            ]

                            for (const selector of participantSelectors) {
                                const elements = document.querySelectorAll(selector)
                                
                                for (const element of elements) {
                                    const name = extractName(element)
                                    if (name && name.length > 0) {
                                        const speaking = isSpeaking(element)
                                        
                                        // Avoid duplicates
                                        if (!speakers.find(s => s.name === name)) {
                                            speakers.push({
                                                name,
                                                id: 0,
                                                timestamp,
                                                isSpeaking: speaking
                                            })
                                        }
                                    }
                                }
                            }

                            return speakers
                        } catch (e) {
                            console.error('[Meet-Browser] Error in getSpeakerFromDocument:', e)
                            return []
                        }
                    }

                    // EXACT SAME checkSpeakers logic as extension
                    async function checkSpeakers() {
                        try {
                            const timestamp = Date.now() - speakerLatency
                            let currentSpeakersList = getSpeakerFromDocument(recordingMode, timestamp)

                            // Filter out bot - EXACT SAME AS EXTENSION
                            currentSpeakersList = currentSpeakersList.filter(
                                (speaker: any) => speaker.name !== botName,
                            )

                            let new_speakers = new Map(
                                currentSpeakersList.map((elem: any) => [elem.name, elem.isSpeaking]),
                            )

                            function areMapsEqual(map1: Map<string, boolean>, map2: Map<string, boolean>): boolean {
                                if (map1.size !== map2.size) {
                                    return false
                                }
                                for (let [key, value] of map1) {
                                    if (!map2.has(key) || map2.get(key) !== value) {
                                        return false
                                    }
                                }
                                return true
                            }

                            // Send data only when a speakers change state is detected - EXACT SAME AS EXTENSION
                            if (!areMapsEqual(CUR_SPEAKERS, new_speakers)) {
                                console.log('[Meet-Browser] Speakers changed, calling callback')
                                await (window as any).meetSpeakersChanged(currentSpeakersList)
                                CUR_SPEAKERS = new_speakers
                            }
                        } catch (e) {
                            console.error('[Meet-Browser] Error in checkSpeakers:', e)
                        }
                    }

                    // EXACT SAME MutationObserver setup as extension (150ms debounce!)
                    MUTATION_OBSERVER = new MutationObserver(function () {
                        if (checkSpeakersTimeout !== null) {
                            clearTimeout(checkSpeakersTimeout)
                        }

                        // Update the last mutation time whenever a mutation is detected - EXACT SAME AS EXTENSION
                        lastMutationTime = Date.now()

                        checkSpeakersTimeout = window.setTimeout(() => {
                            checkSpeakers()
                            checkSpeakersTimeout = null
                        }, MUTATION_DEBOUNCE) // 150ms NOT 1000ms!
                    })

                    // EXACT SAME setupMutationObserver logic as extension
                    async function setupMutationObserver() {
                        const observe_parameters = await getSpeakerRootToObserve(recordingMode)

                        if (!observe_parameters || !observe_parameters[0]) {
                            console.warn('[Meet-Browser] No valid root element to observe')
                            return false
                        }

                        // Disconnect any existing observer before creating a new one - EXACT SAME AS EXTENSION
                        if (MUTATION_OBSERVER) {
                            MUTATION_OBSERVER.disconnect()
                            MUTATION_OBSERVER.observe(observe_parameters[0], observe_parameters[1])
                            console.log('[Meet-Browser] Mutation observer successfully set up')
                            // Reset the last mutation time when we set up a new observer - EXACT SAME AS EXTENSION
                            lastMutationTime = Date.now()
                            return true
                        }
                        return false
                    }

                    // Initial setup
                    setupMutationObserver()

                    // Initial check - same as extension
                    checkSpeakers()

                    // EXACT SAME periodic check as extension - Set up periodic check to verify and potentially reset the mutation observer
                    const periodicCheck = setInterval(async () => {
                        if (document.visibilityState !== 'hidden') {
                            // Check if mutations have stopped being detected, indicating potential DOM changes
                            // that require observer reset. Threshold set to 15s for balanced performance - EXACT SAME AS EXTENSION
                            if (Date.now() - lastMutationTime > 15000) {
                                console.warn('[Meet-Browser] No mutations detected for 15 seconds, resetting observer')
                                await setupMutationObserver()
                            }
                            // Fallback speaker detection with balanced frequency - EXACT SAME AS EXTENSION
                            // Interval set to 15s for good balance between accuracy and performance
                            checkSpeakers()
                        }
                    }, 15000) // 15 seconds for balanced performance - EXACT SAME AS EXTENSION

                    // Cleanup function
                    ;(window as any).meetObserverCleanup = () => {
                        console.log('[Meet-Browser] Cleaning up observer')
                        if (MUTATION_OBSERVER) {
                            MUTATION_OBSERVER.disconnect()
                        }
                        if (checkSpeakersTimeout) {
                            clearTimeout(checkSpeakersTimeout)
                        }
                        clearInterval(periodicCheck)
                    }

                    console.log('[Meet-Browser] Observer setup complete - EXACT EXTENSION LOGIC')
                },
                { 
                    recordingMode: this.recordingMode, 
                    botName: this.botName,
                    speakerLatency: SPEAKER_LATENCY
                }
            )

            console.log('[Meet] Browser-side observer setup completed - EXACT EXTENSION LOGIC')
            
        } catch (error) {
            console.error('[Meet] Error setting up browser observer:', error)
        }
    }

    private areMapsEqual<K, V>(map1: Map<K, V>, map2: Map<K, V>): boolean {
        if (map1.size !== map2.size) {
            return false
        }
        for (let [key, value] of map1) {
            if (!map2.has(key) || map2.get(key) !== value) {
                return false
            }
        }
        return true
    }
} 