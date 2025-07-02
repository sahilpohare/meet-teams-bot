import { BrowserContext, chromium, Page } from '@playwright/test'

export async function openBrowser(
    slowMo: boolean = false,
): Promise<{ browser: BrowserContext }> {
    const width = 1280 // 640
    const height = 720 // 480

    try {
        console.log('Launching persistent context with exact extension args...')

        const context = await chromium.launchPersistentContext('', {
            headless: false,
            viewport: { width, height },
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-rtc-smoothness-algorithm',
                '--disable-webrtc-hw-decoding',
                '--disable-webrtc-hw-encoding',
                '--disable-blink-features=AutomationControlled',
                '--autoplay-policy=no-user-gesture-required',
                '--disable-background-timer-throttling',
                '--enable-features=SharedArrayBuffer',
                '--ignore-certificate-errors',
                '--allow-insecure-localhost',
                '--disable-blink-features=TrustedDOMTypes',
                '--disable-features=TrustedScriptTypes',
                '--disable-features=TrustedHTML',
                '--use-fake-device-for-media-stream',
            ],
            slowMo: slowMo ? 100 : undefined,
            permissions: ['microphone', 'camera'],
            ignoreHTTPSErrors: true,
            acceptDownloads: true,
            bypassCSP: true,
            timeout: 120000,
        })

        return { browser: context }
    } catch (error) {
        console.error('Failed to open browser:', error)
        throw error
    }
}
