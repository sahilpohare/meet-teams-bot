import { Page } from 'playwright'
import { MeetingProvider, RecordingMode } from '../types'

export class HtmlCleaner {
    private page: Page
    private platform: MeetingProvider
    private mode: RecordingMode
    private isActive = false

    constructor(page: Page, platform: MeetingProvider, mode: RecordingMode) {
        this.page = page
        this.platform = platform
        this.mode = mode
    }

    async start(): Promise<void> {
        if (this.isActive) {
            return
        }

        this.isActive = true
        console.log(`[HtmlCleaner] Starting HTML cleanup for ${this.platform} in ${this.mode} mode`)

        // Expose helper function for logging
        await this.page.exposeFunction('htmlCleanerLog', (message: string) => {
            console.log(`[HtmlCleaner-Browser] ${message}`)
        })

        try {
            // EXACT SAME AS EXTENSION - run initial then setup observer
            if (this.mode !== 'audio_only') {
                await this.runInitialCleanup()
                await this.setupContinuousCleanup()
            }

        } catch (error) {
            console.error('[HtmlCleaner] Error starting cleanup:', error)
        }
    }

    private async runInitialCleanup(): Promise<void> {
        console.log('[HtmlCleaner] Running initial HTML cleanup...')

        if (this.platform === 'Meet') {
            await this.page.evaluate((mode: RecordingMode) => {
                // EXACT SAME removeInitialShityHtml as extension
                (async function removeInitialShityHtml(mode: RecordingMode) {
                    let div
                    try {
                        document.querySelectorAll('[data-purpose="non-essential-ui"]').forEach(
                            elem => (elem as HTMLElement).style.display = 'none'
                        );
                    } catch (e) {}
                    
                    try {
                        for (div of document.getElementsByTagName('div')) {
                            if (div.clientWidth === 360 && div.clientHeight === 326) {
                                div.style.display = 'none'
                            }
                        }
                    } catch (e) {}
                    
                    try {
                        for (div of document.getElementsByTagName('div')) {
                            if (div.clientHeight === 26) {
                                div.style.display = 'none'
                            }
                        }
                    } catch (e) {}
                    
                    try {
                        const bannerDiv = document.querySelector('div[role="banner"]') as HTMLElement
                        if (bannerDiv) {
                            bannerDiv.style.opacity = '0'
                        }
                    } catch (e) {}
                    
                    try {
                        for (div of document.getElementsByTagName('div')) {
                            if (div.clientHeight === 20) {
                                div.style.display = 'none'
                            }
                        }
                    } catch (e) {}
                    
                    try {
                        let span
                        for (span of document.getElementsByTagName('span')) {
                            if (span.innerText.includes(':')) {
                                span.parentElement.parentElement.style.display = 'none'
                            }
                        }
                    } catch (e) {}
                    
                    try {
                        // removeBlackBox function
                        const elements: NodeListOf<HTMLElement> = document.querySelectorAll('[data-layout="roi-crop"]')
                        
                        if (elements.length > 0) {
                            let maxWidth: number = 0
                            let maxElement: HTMLElement | null = null

                            elements.forEach((el: HTMLElement) => {
                                const width: number = el.offsetWidth
                                if (width > maxWidth) {
                                    maxWidth = width
                                    maxElement = el
                                }
                            })

                            elements.forEach((el: HTMLElement) => {
                                if (el == maxElement) {
                                    el.style.opacity = '1'
                                    el.style.top = '0'
                                    el.style.left = '0'
                                    el.style.position = 'fixed'
                                    el.style.zIndex = '9000'
                                    el.style.backgroundColor = 'black'
                                } else {
                                    // applyStylesRecursively
                                    let element = el
                                    let depth = 4
                                    while (depth >= 0 && element) {
                                        element.style.opacity = '0'
                                        element.style.border = 'transparent'
                                        element = element.parentElement
                                        depth--
                                    }
                                }
                            })
                        }
                    } catch (e) {}
                    
                    try {
                        const politeDivs = document.querySelectorAll('div[aria-live="polite"]')
                        politeDivs.forEach((div) => {
                            (div as HTMLElement).style.opacity = '0'
                        })
                    } catch (e) {}

                    // People panel shitty HTML remove - EXACT logic from extension with while loop
                    let root: any = null
                    while (root == null) {
                        root = (Array as any)
                            .from(document.querySelectorAll('div'))
                            .find((d) => d.innerText === 'People')?.parentElement?.parentElement
                        if (root != null) {
                            try {
                                root.parentElement.style.opacity = 0
                                root.parentElement.parentElement.style.opacity = 0
                                const rootLeft = (Array as any)
                                    .from(document.querySelectorAll('div'))
                                    .find((d) => d.innerText === 'You')
                                rootLeft.parentElement.parentElement.parentElement.parentElement.style.width = '97vw'
                            } catch (e) {}
                        }
                    }

                    if (mode !== 'gallery_view') {
                        try {
                            const video = document.getElementsByTagName('video')[0] as HTMLVideoElement
                            if (video) {
                                video.style.position = 'fixed'
                                video.style.display = 'block'
                                video.style.left = '0'
                                video.style.top = '0'
                                video.style.zIndex = '900000'
                                if (video?.parentElement?.style) {
                                    video.parentElement.style.background = '#000'
                                    video.parentElement.style.top = '0'
                                    video.parentElement.style.left = '0'
                                    video.parentElement.style.width = '100vw'
                                    video.parentElement.style.height = '100vh'
                                    video.parentElement.style.position = 'fixed'
                                    video.parentElement.style.display = 'flex'
                                    video.parentElement.style.alignItems = 'center'
                                    video.parentElement.style.justifyContent = 'center'
                                }
                            }
                        } catch (e) {}
                    }
                    
                    (window as any).htmlCleanerLog('Meet initial cleanup completed')
                })(mode)
            }, this.mode)
        } else if (this.platform === 'Teams') {
            await this.page.evaluate((mode: RecordingMode) => {
                // EXACT SAME removeInitialShityHtml as extension for Teams
                (async function removeInitialShityHtml(mode: RecordingMode) {
                    // Sleep 1000ms like in extension
                    await new Promise(resolve => setTimeout(resolve, 1000))
                    
                    // EXACT SAME getDocumentRoot as extension - SIMPLE VERSION
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
                    
                    const documentRoot = getDocumentRoot()
                    
                    try {
                        const meetingControls = documentRoot.querySelectorAll(`div[data-tid="app-layout-area--header"]`)
                        if (meetingControls[0] instanceof HTMLElement) {
                            meetingControls[0].style.opacity = '0'
                        }
                    } catch (e) {}

                    try {
                        const style = documentRoot.createElement('style')
                        documentRoot.head.appendChild(style)
                        const sheet = style.sheet
                        sheet?.insertRule(`[data-tid="voice-level-stream-outline"]::before { border: 0px solid rgb(127, 133, 245); }`, sheet.cssRules.length)
                    } catch (e) {}
                    
                    try {
                        const mainArea = documentRoot.querySelector('div[data-tid="app-layout-area--main"]')
                        if (mainArea instanceof HTMLElement) {
                            mainArea.style.height = '100vh'
                            mainArea.style.width = '100vw'
                        }
                    } catch (e) {}
                    
                    (window as any).htmlCleanerLog('Teams initial cleanup completed')
                })(mode)
            }, this.mode)
        }
    }

    private async setupContinuousCleanup(): Promise<void> {
        console.log('[HtmlCleaner] Setting up continuous HTML cleanup - EXACT SAME AS EXTENSION...')

        await this.page.evaluate((args: { platform: MeetingProvider, mode: RecordingMode }) => {
            const { platform, mode } = args
            
            // EXACT SAME debounce logic as extension: 1000ms
            let shittyHtmlTimeout: ReturnType<typeof setTimeout> | null = null
            const SHITTY_HTML_DEBOUNCE = 1000 // EXACT SAME AS EXTENSION

            function removeShityHtml(platform: MeetingProvider, mode: RecordingMode) {
                if (platform === 'Meet') {
                    // EXACT SAME Meet removeShityHtml logic as extension
                    if (mode !== 'gallery_view') {
                        try {
                            const video = document.getElementsByTagName('video')[0] as HTMLVideoElement
                            if (video) {
                                video.style.position = 'fixed'
                                video.style.display = 'block'
                                video.style.left = '0'
                                video.style.top = '0'
                                video.style.zIndex = '1'
                                if (video?.parentElement?.style) {
                                    video.parentElement.style.background = '#000'
                                    video.parentElement.style.top = '0'
                                    video.parentElement.style.left = '0'
                                    video.parentElement.style.width = '100vw'
                                    video.parentElement.style.height = '100vh'
                                    video.parentElement.style.position = 'fixed'
                                    video.parentElement.style.display = 'flex'
                                    video.parentElement.style.alignItems = 'center'
                                    video.parentElement.style.justifyContent = 'center'
                                }
                            }
                        } catch (e) {}

                        try {
                            document.getElementsByTagName('video')[1].style.position = 'fixed'
                        } catch (e) {}
                        
                        try {
                            // removeBlackBox
                            const elements: NodeListOf<HTMLElement> = document.querySelectorAll('[data-layout="roi-crop"]')
                            
                            if (elements.length > 0) {
                                let maxWidth: number = 0
                                let maxElement: HTMLElement | null = null

                                elements.forEach((el: HTMLElement) => {
                                    const width: number = el.offsetWidth
                                    if (width > maxWidth) {
                                        maxWidth = width
                                        maxElement = el
                                    }
                                })

                                elements.forEach((el: HTMLElement) => {
                                    if (el == maxElement) {
                                        el.style.opacity = '1'
                                        el.style.top = '0'
                                        el.style.left = '0'
                                        el.style.position = 'fixed'
                                        el.style.zIndex = '9000'
                                        el.style.backgroundColor = 'black'
                                    } else {
                                        let element = el
                                        let depth = 4
                                        while (depth >= 0 && element) {
                                            element.style.opacity = '0'
                                            element.style.border = 'transparent'
                                            element = element.parentElement
                                            depth--
                                        }
                                    }
                                })
                            }
                        } catch (e) {}
                    }

                    try {
                        const bannerDiv = document.querySelector('div[role="banner"]') as HTMLElement
                        if (bannerDiv) {
                            bannerDiv.style.opacity = '0'
                        }
                    } catch (e) {}
                    
                    try {
                        for (const div of document.getElementsByTagName('div')) {
                            if (div.clientHeight === 164 && div.clientWidth === 322) {
                                div.style.display = 'none'
                            }
                        }
                    } catch (e) {}
                    
                    try {
                        for (const div of document.getElementsByTagName('div')) {
                            if (div.clientHeight === 40) {
                                div.style.opacity = '0'
                            }
                        }
                    } catch (e) {}
                    
                    try {
                        const politeDivs = document.querySelectorAll('div[aria-live="polite"]')
                        politeDivs.forEach((div) => {
                            (div as HTMLElement).style.opacity = '0'
                        })
                    } catch (e) {}
                    
                    try {
                        var icons = Array.from(document.querySelectorAll('i.google-material-icons')).filter((el) => el.textContent?.trim() === 'devices')
                        icons.forEach((icon) => {
                            if (icon.parentElement) {
                                icon.parentElement.style.opacity = '0'
                            }
                        })
                    } catch (e) {}

                    // People panel - EXACT logic with while loop
                    let root: any = null
                    while (root == null) {
                        root = (Array as any)
                            .from(document.querySelectorAll('div'))
                            .find((d) => d.innerText === 'People')?.parentElement?.parentElement
                        if (root != null) {
                            try {
                                root.parentElement.style.opacity = 0
                                root.parentElement.parentElement.style.opacity = 0
                                const rootLeft = (Array as any)
                                    .from(document.querySelectorAll('div'))
                                    .find((d) => d.innerText === 'You')
                                rootLeft.parentElement.parentElement.parentElement.parentElement.style.width = '97vw'
                            } catch (e) {}
                        }
                    }

                    try {
                        var moodIcons = Array.from(document.querySelectorAll('i.google-material-icons')).filter((el) => el.textContent?.trim() === 'mood')
                        if (moodIcons.length > 0) {
                            var icon = moodIcons[0]
                            var currentElement = icon.parentElement
                            while (currentElement != null) {
                                var bgColor = window.getComputedStyle(currentElement).backgroundColor
                                if (bgColor === 'rgb(32, 33, 36)') {
                                    currentElement.style.opacity = '0'
                                    break
                                }
                                currentElement = currentElement.parentElement
                            }
                        }
                    } catch (e) {}
                    
                } else if (platform === 'Teams') {
                    // EXACT SAME Teams removeShityHtml logic as extension
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
                    
                    const documentRoot = getDocumentRoot()
                    
                    try {
                        const menus = documentRoot.querySelectorAll('[role="menu"]')
                        const menu = menus[0] || menus
                        if (menu instanceof HTMLElement) {
                            menu.style.position = 'fixed'
                            menu.style.top = '0'
                            menu.style.left = '0'
                            menu.style.width = '100vw'
                            menu.style.height = '100vh'
                            menu.style.zIndex = '9999'
                            menu.style.backgroundColor = 'black'
                        }
                    } catch (e) {}

                    try {
                        documentRoot.querySelectorAll('div').forEach((div) => {
                            if (div.clientHeight === 137 && div.clientWidth === 245) {
                                div.style.opacity = '0'
                            }
                        })
                    } catch (e) {}

                    try {
                        const mainArea = documentRoot.querySelector('div[data-tid="app-layout-area--main"]')
                        if (mainArea instanceof HTMLElement) {
                            mainArea.style.height = '100vh'
                            mainArea.style.width = '100vw'
                        }
                    } catch (e) {}
                }
            }

            // EXACT SAME MutationObserver setup as extension - ONE SIMPLE OBSERVER
            const observer = new MutationObserver(() => {
                // Debounce : évite d'appeler removeShityHtml trop souvent
                // Les mutations sont toujours détectées, mais traitées max 1 fois/seconde
                if (shittyHtmlTimeout !== null) {
                    clearTimeout(shittyHtmlTimeout)
                }

                shittyHtmlTimeout = setTimeout(() => {
                    if (mode !== 'audio_only') {
                        try {
                            removeShityHtml(platform, mode)
                            if ((window as any).htmlCleanerLog) {
                                (window as any).htmlCleanerLog('ShittyHtml cleanup executed (debounced)')
                            }
                        } catch (e) {
                            if ((window as any).htmlCleanerLog) {
                                (window as any).htmlCleanerLog('Error in shittyHtml removal: ' + e)
                            }
                        }
                    }
                    shittyHtmlTimeout = null
                }, SHITTY_HTML_DEBOUNCE)
            })

            // Observer le document entier pour les changements - EXACT SAME AS EXTENSION
            if (document.documentElement) {
                // Vérifier que documentElement existe
                observer.observe(document.documentElement, {
                    childList: true,
                    subtree: true,
                })
                if ((window as any).htmlCleanerLog) {
                    (window as any).htmlCleanerLog('ShittyHtml observer started with 1s debounce for CPU optimization')
                }
            } else {
                if ((window as any).htmlCleanerLog) {
                    (window as any).htmlCleanerLog('Document root element not found')
                }
            }

            // Store observer reference for cleanup - SIMPLE SINGLE OBSERVER
            (window as any).__htmlCleanupObserver = observer
            
        }, { platform: this.platform, mode: this.mode })
    }

    async stop(): Promise<void> {
        if (!this.isActive) {
            return
        }

        console.log('[HtmlCleaner] Stopping HTML cleanup...')
        this.isActive = false

        try {
            // Stop the MutationObserver - SIMPLE SINGLE OBSERVER
            await this.page.evaluate(() => {
                if ((window as any).__htmlCleanupObserver) {
                    (window as any).__htmlCleanupObserver.disconnect()
                    delete (window as any).__htmlCleanupObserver
                    if ((window as any).htmlCleanerLog) {
                        (window as any).htmlCleanerLog('MutationObserver stopped')
                    }
                }
            })
        } catch (error) {
            console.error('[HtmlCleaner] Error stopping cleanup:', error)
        }
    }
} 