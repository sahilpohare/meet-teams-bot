import * as fs from 'fs'

import { dirname, join } from 'path'
import { Browser, ConsoleMessage, Page } from 'puppeteer'

import puppeteer from 'puppeteer-extra'
import { MeetingHandle } from './meeting'
import { s3cp } from './s3'

// add stealth plugin and use defaults (all evasion techniques)
const StealthPlugin = require('puppeteer-extra-plugin-stealth')

const EXTENSION_NAME = 'spoke'
// NOTE: local scripts sed this! (correct value: '<slash>usr<slash>bin<slash>google-chrome')
// TODO: make an env for this, stop overriding with local scripts...
const GOOGLE_CHROME_EXECUTABLE_PATH =
    process.env.GOOGLE_CHROME_EXECTUTABLE_PATH || '/usr/bin/google-chrome'

puppeteer.use(StealthPlugin())

const HEIGHT_INTERFACE_CHROME = 120
const HEIGHT_FRAMEBUFFER = 720
const WIDTH_FRAMEBUFFER = 1280

export function listenPage(page: Page) {
    const describe = (jsHandle) => {
        return jsHandle.executionContext().evaluate((obj) => {
            const safeStringify = (obj) => {
                let cache = []
                const retVal = JSON.stringify(obj, (_key, value) =>
                    typeof value === 'object' && value !== null
                        ? cache.includes(value)
                            ? undefined // Duplicate reference found, discard key
                            : cache.push(value) && value // Store value in our collection
                        : value,
                )
                cache = null
                return retVal
            }

            return `OBJ: ${typeof obj}, ${safeStringify(obj)}`
        }, jsHandle)
    }

    // listen to browser console there
    page.on('console', async (message: ConsoleMessage) => {
        try {
            const args = await Promise.all(
                message.args().map((arg) => describe(arg)),
            )
            // make ability to paint different console[types]
            const type = message.type().substr(0, 3).toUpperCase()
            let text = ''
            for (let i = 0; i < args.length; ++i) {
                text += `[${i}] ${args[i]} `
            }
            const location = message.location()
            const tags = `${location.url}:${location.lineNumber}}`
            switch (type) {
                case 'LOG':
                    console.log(`${tags}\n${text}`)
                    break
                case 'WAR':
                    console.log('\x1b[38;5;214m%s\x1b[0m', `${tags}\n${text}`)
                    break
                case 'ERR':
                    console.log('\x1b[31m%s\x1b[0m', `${tags}\n${text}`)
                    break
                case 'INF':
                    console.log('\x1b[32m%s\x1b[0m', `${tags}\n${text}`)
                    break
                default:
                    console.log(`DEFAULT CASE ${type} ! ${tags}\n${text}`)
            }
        } catch (e) {
            console.log(`Failed to log forward logs: ${e}`)
        }
    })
}

export function removeListenPage(page: Page) {
    page.removeAllListeners('console')
}

export async function screenshot(page: Page, name: string) {
    try {
        const date = new Date()
            .toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
            })
            .replace(/\//g, '-')
        const link = `./screenshot/${date}/${MeetingHandle.getUserId()}/${MeetingHandle.getBotId()}/${name.replaceAll(
            '/',
            '',
        )}.jpg`
        // try { await unlink(link) } catch (e) { }
        await fs.promises.mkdir(dirname(link), { recursive: true })
        await page.screenshot({ path: link })

        await s3cp(link, link.substring(2))
    } catch (e) {
        console.error(`Failed to take screenshot ${e}`)
    }
}

export async function findBackgroundPage(
    browser: Browser,
    extensionId: string,
): Promise<Page> {
    console.log('waiting for target')
    console.log(await browser.version())
    try {
        const extensionTarget = await browser.waitForTarget((target: any) => {
            console.log('target url', target.url())
            return (
                target.type() === 'background_page' &&
                target.url().startsWith(`chrome-extension://${extensionId}/`)
            )
        })
        const backgroundPage = await extensionTarget.page()
        return backgroundPage
    } catch (e) {
        console.error(`wait for target error ${e}`)
    }
    throw 'failed to get background page'

    // const e = targets.find((target) => {
    //     const _targetInfo = (target as any)._targetInfo
    //     return _targetInfo.title === EXTENSION_NAME && _targetInfo.type === 'background_page';
    // });

    // const extensionTarget = targets.find((target: any) => {
    //     return target.type() === 'background_page' && target.url().startsWith(`chrome-extension://${extensionId}/`)
    // })
}

export async function getCachedExtensionId() {
    const data: string = await fs.promises.readFile(
        './extension_id.txt',
        'utf8',
    )
    // const trueExtensionId = await getExtensionId()
    // console.log({trueExtensionId}, {data})
    console.log(`getCachedExtensionId() = ${data.trim()}`)
    return data.trim()
}

export async function getExtensionId() {
    let error = null
    const NUMBER_TRY_GET_EXTENSION_ID = 1000
    for (let i = 0; i < NUMBER_TRY_GET_EXTENSION_ID; i++) {
        try {
            const extensionId = await tryGetExtensionId()
            console.log(extensionId)
            return extensionId
        } catch (e) {
            console.log(`Failed to get extension id: ${e}`, {
                retry: i,
            })
            error = e
            continue
        }
    }
    throw error
}

//https://gokatz.me/blog/automate-chrome-extension-testing/
export async function tryGetExtensionId() {
    const pathToExtension = join(
        __dirname,
        '..',
        '..',
        'chrome_extension',
        'dist',
    )
    console.log(`Path to Extension = ${pathToExtension}`)
    const width = WIDTH_FRAMEBUFFER
    const height = HEIGHT_FRAMEBUFFER + HEIGHT_INTERFACE_CHROME

    const browser = await puppeteer.launch({
        args: [
            `--window-size=${width},${height}`,
            '--no-sandbox',
            '--disable-setuid-sandbox',
            `--load-extension=${pathToExtension}`,

            '--autoplay-policy=no-user-gesture-required',
            '--remote-debugging-address=0.0.0.0',
            '--remote-debugging-port=9222',
            '--disable-default-apps',
            '--disable-client-side-phishing-detection',
            '--disable-background-timer-throttling',
            '--disable-dev-shm-usage',
            `--disable-extensions-except=${pathToExtension}`,
            `--enable-features=SharedArrayBuffer`,

            // '--use-fake-ui-for-media-stream',
            // '--use-fake-device-for-media-stream',
            // '--use-file-for-fake-video-capture=/Users/vcombey/Downloads/example.y4m',
        ],
        executablePath: GOOGLE_CHROME_EXECUTABLE_PATH,
        headless: false,
        devtools: false,
        defaultViewport: null,
    })

    await reload_extension(browser)

    const targets = browser.targets()
    console.log(targets)

    // Hang infinitely
    // await new Promise(() => {});

    const extensionTarget = targets.find((target) => {
        const _targetInfo = (target as any)._targetInfo
        return (
            _targetInfo.title === EXTENSION_NAME &&
            _targetInfo.type === 'background_page'
        )
    })
    const extensionUrl = extensionTarget.url()
    const [, , extensionId] = extensionUrl.split('/')
    await browser.close()
    return extensionId
}
export async function openBrowser(
    extensionId: string,
    useChromium: boolean = false,
): Promise<{ browser: Browser; backgroundPage: Page }> {
    let error = null
    const NUMBER_TRY_OPEN_BROWSER = 5
    for (let i = 0; i < NUMBER_TRY_OPEN_BROWSER; i++) {
        try {
            const browser = await tryOpenBrowser(extensionId, useChromium)
            await reload_extension(browser)

            const backgroundPage = await findBackgroundPage(
                browser,
                extensionId,
            )

            return { browser, backgroundPage }
        } catch (e) {
            console.error(`Failed to open browser: ${e}`, {
                retry: i,
            })
            error = e
            continue
        }
    }
    throw error
}

export async function tryOpenBrowser(
    extensionId: string,
    useChromium: boolean = false,
): Promise<Browser> {
    const pathToExtension =
        process.env.PROFILE !== 'DEV'
            ? join(__dirname, '..', '..', 'chrome_extension', 'dist')
            : join(__dirname, '..', 'chrome_extension', 'dist')

    console.log('Path to Extension : ', pathToExtension)
    const width = WIDTH_FRAMEBUFFER
    const height = HEIGHT_FRAMEBUFFER + HEIGHT_INTERFACE_CHROME

    const launchOptions: any = {
        ignoreDefaultArgs: ['--mute-audio'],
        args: [
            `--window-size=${width},${height}`,
            '--no-sandbox',
            '--disable-setuid-sandbox',
            `--load-extension=${pathToExtension}`,
            '--autoplay-policy=no-user-gesture-required',
            '--remote-debugging-address=0.0.0.0',
            '--remote-debugging-port=9223',
            '--disable-default-apps',
            '--disable-client-side-phishing-detection',
            '--disable-background-timer-throttling',
            '--disable-dev-shm-usage',
            `--disable-extensions-except=${pathToExtension}`,
            '--enable-features=SharedArrayBuffer',
            `--whitelisted-extension-id=${extensionId}`,
            '--ignore-certificate-errors',
            '--ignore-ssl-errors',
            '--allow-insecure-localhost',
            '--unsafely-treat-insecure-origin-as-secure=http://localhost:3005',
        ],
        headless: false,
        devtools: false,
        defaultViewport: null,
    }

    if (!useChromium) {
        launchOptions.executablePath = GOOGLE_CHROME_EXECUTABLE_PATH
    }

    const browser = await puppeteer.launch(launchOptions)

    const pages = await browser.pages()
    const page = pages[0]

    await page
        .target()
        .createCDPSession()
        .then(async (session) => {
            await session.send('Browser.grantPermissions', {
                origin: 'http://localhost:3005',
                permissions: ['audioCapture', 'videoCapture'],
            })
        })

    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'mediaDevices', {
            value: {
                getUserMedia: async () => ({
                    audio: true,
                    video: true,
                }),
            },
        })
    })

    return browser
}

// This function is a hack because we cannot get extension without reloading it in moderns browsers
async function reload_extension(browser: Browser) {
    const page = await browser.newPage()
    await page.goto('chrome://extensions/')

    await new Promise((resolve) => setTimeout(resolve, 1000))
    // <cr-icon-button id="dev-reload-button"
    //     class="icon-refresh no-overlap"
    //     aria-label="Reload"
    //     aria-describedby="a11yAssociation"
    //     aria-disabled="false"
    //     role="button"
    //     tabindex="0">
    // </cr-icon-button>
    // Traditional methods of clicking on an object don't work here.
    // So we generate a manual mouse click at specific coordinates.
    const X_RELOAD_BUTTON = 540
    const Y_RELOAD_BUTTON = 220
    await page.mouse.click(X_RELOAD_BUTTON, Y_RELOAD_BUTTON, {
        button: 'left',
        clickCount: 1,
    })
    await new Promise((resolve) => setTimeout(resolve, 1000))
}
