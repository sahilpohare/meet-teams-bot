import { BrowserContext, chromium, Page } from '@playwright/test'
import * as fs from 'fs'
import { join } from 'path'

// const EXTENSION_NAME = 'spoke'
const GOOGLE_CHROME_EXECUTABLE_PATH =
    process.env.GOOGLE_CHROME_EXECTUTABLE_PATH || '/usr/bin/google-chrome'
const USER_DATA_DIR = '/tmp/test-user-data-dir'

type Resolution = {
    width: number
    height: number
}

const P480: Resolution = {
    width: 854,
    height: 480,
}

const P720: Resolution = {
    width: 1280,
    height: 720,
}

const HEIGHT_INTERFACE_CHROME = 120
var RESOLUTION: Resolution = P720

export async function getCachedExtensionId() {
    try {
        const data: string = await fs.promises.readFile(
            './extension_id.txt',
            'utf8',
        )
        const trimmedId = data.trim()
        console.log(`getCachedExtensionId() = ${trimmedId}`)
        return trimmedId
    } catch (error) {
        console.error('Error reading extension ID:', error)
        throw new Error('Failed to read extension ID')
    }
}

export async function openBrowser(
    extensionId: string,
    useChromium: boolean,
    lowResolution: boolean,
    slowMo: boolean = false,
): Promise<{ browser: BrowserContext; backgroundPage: Page }> {
    if (lowResolution) {
        RESOLUTION = P480
    }

    const pathToExtension = join(
        __dirname,
        '..',
        '..',
        'chrome_extension',
        'dist',
    )
    console.log('Path to Extension : ', pathToExtension)

    const width = RESOLUTION.width
    const height = RESOLUTION.height + HEIGHT_INTERFACE_CHROME

    try {
        console.log('Launching persistent context...')
        const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
            headless: false,
            executablePath: GOOGLE_CHROME_EXECUTABLE_PATH,
            viewport: { width, height },
            args: [
                '--no-sandbox',
                '--disable-rtc-smoothness-algorithm',
                '--disable-webrtc-hw-decoding',
                '--disable-webrtc-hw-encoding',
                '--disable-blink-features=AutomationControlled',
                '--disable-setuid-sandbox',
                `--disable-extensions-except=${pathToExtension}`,
                `--load-extension=${pathToExtension}`,
                '--autoplay-policy=no-user-gesture-required',
                '--disable-background-timer-throttling',
                '--enable-features=SharedArrayBuffer',
                `--whitelisted-extension-id=${extensionId}`,
                '--ignore-certificate-errors',
                '--allow-insecure-localhost',
                '--disable-blink-features=TrustedDOMTypes',
                '--disable-features=TrustedScriptTypes',
                '--disable-features=TrustedHTML',
            ],
            slowMo: slowMo ? 100 : undefined,
            permissions: ['microphone', 'camera'],
            ignoreHTTPSErrors: true,
            acceptDownloads: true,
            bypassCSP: true,
            timeout: 120000,
        })

        console.log('Waiting for background page...')
        let [backgroundPage] = context.backgroundPages()
        if (!backgroundPage) {
            console.log('No background page found, waiting for event...')
            backgroundPage = await context.waitForEvent('backgroundpage')
        }

        if (!backgroundPage) {
            throw new Error('Could not find extension background page')
        }

        console.log('Background page found')
        return { browser: context, backgroundPage }
    } catch (error) {
        console.error('Failed to open browser:', error)
        throw error
    }
}