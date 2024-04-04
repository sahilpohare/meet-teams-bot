const { readFile, mkdir } = require('fs').promises
import { dirname } from 'path'
const chalk = require('chalk')
// import * as puppeteer from 'puppeteer'
import { Browser, ConsoleMessage, Page } from 'puppeteer'
import { MeetingHandle } from './meeting'
import { s3cp } from './s3'
const puppeteer = require('puppeteer-extra')
// add stealth plugin and use defaults (all evasion techniques)
const StealthPlugin = require('puppeteer-extra-plugin-stealth')

const EXTENSION_NAME = 'spoke'
// NOTE: local scripts sed this! (correct value: '<slash>usr<slash>bin<slash>google-chrome')
// TODO: make an env for this, stop overriding with local scripts...
const GOOGLE_CHROME_EXECTUTABLE_PATH =
    process.env.GOOGLE_CHROME_EXECTUTABLE_PATH || '/usr/bin/google-chrome'

puppeteer.use(StealthPlugin())

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

    const colors: any = {
        LOG: chalk.grey,
        ERR: chalk.red,
        WAR: chalk.yellow,
        INF: chalk.cyan,
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
            const tags = { location: `${location.url}:${location.lineNumber}` }
            if (type === 'LOG') {
                console.log(text, tags)
            } else {
                console.log(text, tags)
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
        const link = `./screenshot/${date}/${MeetingHandle.getUserId()}/${name.replaceAll(
            '/',
            '',
        )}.jpg`
        // try { await unlink(link) } catch (e) { }
        await mkdir(dirname(link), { recursive: true })
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
    const data: string = await readFile('./extension_id.txt', 'utf8')
    // const trueExtensionId = await getExtensionId()
    // console.log({trueExtensionId}, {data})
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
    const pathToExtension = require('path').join(
        __dirname,
        '..',
        '..',
        'chrome_extension',
        'dist',
    )
    // const pathToExtension = getPathToExtension()
    const width = 905
    const height = 510 + 120
    const browser = await puppeteer.launch({
        args: [
            '--remote-debugging-address=0.0.0.0',
            '--remote-debugging-port=9222',
            '--disable-default-apps',
            '--disable-client-side-phishing-detection',
            '--disable-background-timer-throttling',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            `--disable-extensions-except=${pathToExtension}`,
            `--load-extension=${pathToExtension}`,
            `--window-size=${width},${height}`,
            `--enable-features=SharedArrayBuffer`,
            '--use-fake-ui-for-media-stream',
        ],
        executablePath: GOOGLE_CHROME_EXECTUTABLE_PATH,
        headless: false,
        devtools: false,
        defaultViewport: null,
    })
    const page = await browser.newPage()
    const targets = browser.targets()
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

export async function openBrowser(extensionId: string): Promise<Browser> {
    let error = null
    const NUMBER_TRY_OPEN_BROWSER = 5
    for (let i = 0; i < NUMBER_TRY_OPEN_BROWSER; i++) {
        try {
            const browser = await tryOpenBrowser(extensionId)
            return browser
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
export async function tryOpenBrowser(extensionId: string): Promise<Browser> {
    const pathToExtension = require('path').join(
        __dirname,
        '..',
        '..',
        'chrome_extension',
        'dist',
    )
    const width = 905
    const height = 510 + 120
    const browser = await puppeteer.launch({
        args: [
            '--remote-debugging-address=0.0.0.0',
            '--remote-debugging-port=9223',
            '--disable-default-apps',
            '--disable-client-side-phishing-detection',
            '--disable-background-timer-throttling',
            `--whitelisted-extension-id=${extensionId}`,

            // '--use-fake-ui-for-media-stream',
            // '--use-fake-device-for-media-stream',
            // '--use-file-for-fake-video-capture=/Users/vcombey/Downloads/example.y4m',

            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            `--disable-extensions-except=${pathToExtension}`,
            `--load-extension=${pathToExtension}`,
            `--window-size=${width},${height}`,
            `--enable-features=SharedArrayBuffer`,
        ],
        executablePath: GOOGLE_CHROME_EXECTUTABLE_PATH,
        headless: false,
        devtools: false,
        defaultViewport: null,
    })
    return browser
}
