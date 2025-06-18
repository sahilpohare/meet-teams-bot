import { Page } from '@playwright/test'
import { RecordingMode, SpeakerData } from '../../types'

export const SPEAKER_LATENCY = 1500 // ms - same as extension

export class TeamsSpeakersObserver {
    private page: Page
    private isObserving: boolean = false
    private fallbackInterval: NodeJS.Timeout | null = null
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
            console.warn('[Teams] Speakers observer already running')
            return
        }

        console.log('[Teams] Starting speakers observation...')
        this.isObserving = true

        // Expose callback function to the page
        await this.page.exposeFunction('teamsSpeakersChanged', async (speakers: SpeakerData[]) => {
            try {
                console.log(`[Teams] Browser callback: ${speakers.length} speakers`)
                // Filter out bot - same as extension
                const filteredSpeakers = speakers.filter(
                    (speaker) => speaker.name !== this.botName,
                )

                // Check if speakers have changed - exactly same logic as extension
                const newSpeakers = new Map(
                    filteredSpeakers.map((elem) => [elem.name, elem.isSpeaking]),
                )

                if (!this.areMapsEqual(this.lastSpeakers, newSpeakers)) {
                    console.log(`[Teams] 🎤 SPEAKERS CHANGED: ${filteredSpeakers.length} participants`)
                    this.onSpeakersChange(filteredSpeakers)
                    this.lastSpeakers = newSpeakers
                }
            } catch (error) {
                console.error('[Teams] Error in speakers callback:', error)
            }
        })

        // Initialize the observer in the browser context - EXACT SAME AS EXTENSION
        console.log('[Teams] Setting up browser-side observer...')
        await this.setupBrowserObserver()

        console.log('[Teams] Speakers observer started successfully')
    }

    public stopObserving(): void {
        if (!this.isObserving) {
            return
        }

        console.log('[Teams] Stopping speakers observer...')
        this.isObserving = false

        // Stop browser-side observer
        this.page.evaluate(() => {
            if ((window as any).teamsObserverCleanup) {
                (window as any).teamsObserverCleanup()
            }
        }).catch(e => console.error('[Teams] Error cleaning up browser observer:', e))

        if (this.fallbackInterval) {
            clearInterval(this.fallbackInterval)
            this.fallbackInterval = null
        }

        console.log('[Teams] Speakers observer stopped')
    }

    private async setupBrowserObserver(): Promise<void> {
        try {
            console.log('[Teams] Setting up browser-side observer - EXACT EXTENSION LOGIC...')
            
            await this.page.evaluate(
                ({ recordingMode, botName, speakerLatency }) => {
                    // Cleanup existing observer
                    if ((window as any).teamsObserverCleanup) {
                        (window as any).teamsObserverCleanup()
                    }

                    console.log('[Teams-Browser] Setting up observation - EXACT EXTENSION LOGIC')

                    // EXACT SAME VARIABLES AS EXTENSION (global scope like extension)
                    let CUR_SPEAKERS = new Map<string, boolean>()
                    let checkSpeakersTimeout: number | null = null
                    const MUTATION_DEBOUNCE = 150 // EXACT SAME AS EXTENSION - 150ms NOT 1000ms!
                    let lastMutationTime = Date.now()
                    let MUTATION_OBSERVER: MutationObserver | null = null

                    // EXACT SAME getDocumentRoot as extension
                    function getDocumentRoot(): Document {
                        for (let iframe of document.querySelectorAll('iframe')) {
                            try {
                                const doc = iframe.contentDocument || iframe.contentWindow?.document
                                if (doc) {
                                    return doc
                                }
                            } catch (e) {}
                        }
                        return document
                    }

                    // EXACT SAME helper functions as extension
                    function getParticipantName(name: Element): string {
                        const nameBlackList = ['Content shared by', 'Leaving...']
                        const toSplitOn = [
                            ', video is on,',
                            ', muted,',
                            ', Context menu is available',
                            '(Unverified)',
                            'left the meeting',
                            'Leaving...',
                        ]

                        const ariaLabel = name.getAttribute('aria-label') || ''
                        let result: string = ariaLabel

                        for (const blackListed of nameBlackList) {
                            if (ariaLabel.includes(blackListed)) {
                                return ''
                            }
                        }

                        for (const splitTerm of toSplitOn) {
                            result = result.split(splitTerm)[0]
                        }

                        return result
                    }

                    function isBlueish(color: string): boolean {
                        color = color.toLowerCase().trim()
                        let rgb: number[] | null = null

                        if (color.startsWith('#')) {
                            if (color.length === 4) {
                                const r = parseInt(color[1] + color[1], 16)
                                const g = parseInt(color[2] + color[2], 16)
                                const b = parseInt(color[3] + color[3], 16)
                                rgb = [r, g, b]
                            } else if (color.length === 7) {
                                const r = parseInt(color.slice(1, 3), 16)
                                const g = parseInt(color.slice(3, 5), 16)
                                const b = parseInt(color.slice(5, 7), 16)
                                rgb = [r, g, b]
                            }
                        } else {
                            const match = color.match(/\d+/g)
                            if (match && match.length >= 3) {
                                rgb = match.map(Number).slice(0, 3)
                            }
                        }

                        if (rgb && rgb.length === 3) {
                            const [r, g, b] = rgb
                            return b > 180 && b > r + 40 && b > g + 40 && r < 150 && g < 150
                        }
                        return false
                    }

                    function checkElementAndPseudo(el: HTMLElement): boolean {
                        const style = window.getComputedStyle(el)
                        const beforeStyle = window.getComputedStyle(el, '::before')
                        const borderStyle = window.getComputedStyle(el)

                        // Old teams
                        if (el.getAttribute('data-tid') === 'participant-speaker-ring') {
                            return parseFloat(style.opacity) === 1
                        }

                        // New teams
                        if (
                            el.getAttribute('data-tid') === 'voice-level-stream-outline' &&
                            el.closest('[data-stream-type="Video"]')
                        ) {
                            const hasVdiFrameClass = el.classList.contains('vdi-frame-occlusion')
                            const borderColor = beforeStyle.borderColor || beforeStyle.borderTopColor
                            const borderOpacity = parseFloat(beforeStyle.opacity)
                            return hasVdiFrameClass || (isBlueish(borderColor) && borderOpacity === 1)
                        }

                        // Live platform
                        if (
                            el.getAttribute('data-tid') === 'voice-level-stream-outline' &&
                            window.location.href.includes('live')
                        ) {
                            const hasVdiFrameClass = el.classList.contains('vdi-frame-occlusion')
                            const borderOpacity =
                                parseFloat(beforeStyle.opacity) || parseFloat(borderStyle.opacity)
                            const borderColor =
                                beforeStyle.borderColor ||
                                beforeStyle.borderTopColor ||
                                borderStyle.borderColor
                            return hasVdiFrameClass || (isBlueish(borderColor) && borderOpacity === 1)
                        }

                        return false
                    }

                    function checkIfSpeaking(element: HTMLElement): boolean {
                        let isSpeaking: boolean = checkElementAndPseudo(element)
                        if (!isSpeaking) {
                            element.querySelectorAll('*').forEach((child) => {
                                if (checkElementAndPseudo(child as HTMLElement)) {
                                    isSpeaking = true
                                }
                            })
                        }
                        return isSpeaking
                    }

                    // EXACT SAME getSpeakerFromDocument as extension
                    function getSpeakerFromDocument(recordingMode: string, timestamp: number): any[] {
                        try {
                            const documentRoot = getDocumentRoot()

                            const oldInterfaceElements = documentRoot.querySelectorAll(
                                '[data-cid="calling-participant-stream"]',
                            )
                            const newInterfaceElements = documentRoot.querySelectorAll(
                                '[data-stream-type="Video"]',
                            )
                            const liveElements = documentRoot.querySelectorAll('[data-tid="menur1j"]')

                            const speakerElements =
                                oldInterfaceElements.length > 0
                                    ? oldInterfaceElements
                                    : newInterfaceElements.length > 0
                                    ? newInterfaceElements
                                    : liveElements

                            if (speakerElements.length === 0) {
                                return []
                            }

                            const speakers = Array.from(speakerElements)
                                .map((element) => {
                                    if (element.hasAttribute('data-cid')) {
                                        // Old teams
                                        const name = getParticipantName(element)
                                        if (name !== '') {
                                            if (element.getAttribute('aria-label')?.includes(', muted,')) {
                                                return {
                                                    name,
                                                    id: 0,
                                                    timestamp,
                                                    isSpeaking: false,
                                                }
                                            } else {
                                                return {
                                                    name,
                                                    id: 0,
                                                    timestamp,
                                                    isSpeaking: checkIfSpeaking(element as HTMLElement),
                                                }
                                            }
                                        }
                                    } else if (
                                        element.hasAttribute('data-tid') &&
                                        element.getAttribute('data-tid') === 'menur1j'
                                    ) {
                                        // Live platform
                                        const name = element.getAttribute('aria-label')?.split(',')[0] || ''
                                        if (name) {
                                            const micIcon = element.querySelector(
                                                '[data-cid="roster-participant-muted"]',
                                            )
                                            const isMuted = micIcon ? true : false
                                            const voiceLevelIndicator = element.querySelector(
                                                '[data-tid="voice-level-stream-outline"]',
                                            )
                                            const isSpeaking =
                                                !isMuted && voiceLevelIndicator
                                                    ? checkElementAndPseudo(voiceLevelIndicator as HTMLElement)
                                                    : false

                                            return {
                                                name,
                                                id: 0,
                                                timestamp,
                                                isSpeaking,
                                            }
                                        }
                                    } else {
                                        // New teams
                                        const name = element.getAttribute('data-tid')
                                        if (name) {
                                            const micPath = element.querySelector('g.ui-icon__outline path')
                                            const isMuted =
                                                micPath?.getAttribute('d')?.startsWith('M12 5v4.879') || false
                                            const voiceLevelIndicator = element.querySelector(
                                                '[data-tid="voice-level-stream-outline"]',
                                            )
                                            const isSpeaking =
                                                voiceLevelIndicator && !isMuted
                                                    ? checkElementAndPseudo(voiceLevelIndicator as HTMLElement)
                                                    : false

                                            return {
                                                name,
                                                id: 0,
                                                timestamp,
                                                isSpeaking,
                                            }
                                        }
                                    }
                                    return undefined
                                })
                                .filter((value): value is any => value !== undefined)

                            return speakers

                        } catch (e) {
                            console.error('[Teams-Browser] Error in getSpeakerFromDocument:', e)
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
                                console.log('[Teams-Browser] Speakers changed, calling callback')
                                await (window as any).teamsSpeakersChanged(currentSpeakersList)
                                CUR_SPEAKERS = new_speakers
                            }
                        } catch (e) {
                            console.error('[Teams-Browser] Error in checkSpeakers:', e)
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
                        const documentRoot = getDocumentRoot()
                        const observeConfig = {
                            attributes: true,
                            childList: true,
                            subtree: true,
                            attributeFilter: ['style', 'class'],
                        }

                        // Disconnect any existing observer before creating a new one - EXACT SAME AS EXTENSION
                        if (MUTATION_OBSERVER) {
                            MUTATION_OBSERVER.disconnect()
                            MUTATION_OBSERVER.observe(documentRoot, observeConfig)
                            console.log('[Teams-Browser] Mutation observer successfully set up')
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
                                console.warn('[Teams-Browser] No mutations detected for 15 seconds, resetting observer')
                                await setupMutationObserver()
                            }
                            // Fallback speaker detection with balanced frequency - EXACT SAME AS EXTENSION
                            // Interval set to 15s for good balance between accuracy and performance
                            checkSpeakers()
                        }
                    }, 15000) // 15 seconds for balanced performance - EXACT SAME AS EXTENSION

                    // Cleanup function
                    ;(window as any).teamsObserverCleanup = () => {
                        console.log('[Teams-Browser] Cleaning up observer')
                        if (MUTATION_OBSERVER) {
                            MUTATION_OBSERVER.disconnect()
                        }
                        if (checkSpeakersTimeout) {
                            clearTimeout(checkSpeakersTimeout)
                        }
                        clearInterval(periodicCheck)
                    }

                    console.log('[Teams-Browser] Observer setup complete - EXACT EXTENSION LOGIC')
                },
                { 
                    recordingMode: this.recordingMode, 
                    botName: this.botName,
                    speakerLatency: SPEAKER_LATENCY
                }
            )

            console.log('[Teams] Browser-side observer setup completed - EXACT EXTENSION LOGIC')
            
        } catch (error) {
            console.error('[Teams] Error setting up browser observer:', error)
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