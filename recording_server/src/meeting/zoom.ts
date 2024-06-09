import * as puppeteer from 'puppeteer'
import { Page } from 'puppeteer'
import { URL } from 'url'
import { JoinError, JoinErrorCode } from '../meeting'
import { screenshot } from '../puppeteer'
import {
    CancellationToken,
    MeetingParams,
    MeetingProviderInterface,
} from '../types'
import { sleep } from '../utils'

export class ZoomProvider implements MeetingProviderInterface {
    constructor() {}
    async parseMeetingUrl(browser: puppeteer.Browser, meeting_url: string) {
        if (meeting_url.startsWith('https://www.google.com')) {
            try {
                const url = new URL(meeting_url)
                const params = url.searchParams
                const q = params.get('q')

                console.log({ q })
                const { meetingId, password } = parse(q)
                return { meetingId, password }
            } catch (e) {
                console.error('[parseMeetingUrl] parse meeting url', e)
                throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
            }
        }
        try {
            try {
                const { meetingId, password } = parse(meeting_url)
                if (!(/^\d+$/.test(meetingId) || meetingId === '')) {
                    throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
                }
                return { meetingId, password }
            } catch (e) {
                console.error('error requesting meeting url')
                try {
                    const page = await browser.newPage()
                    console.log('goto: ', meeting_url)
                    await page.goto(meeting_url, { waitUntil: 'networkidle2' })
                    const url = page.url()
                    console.log({ url })
                    const { meetingId, password } = parse(url)

                    try {
                        await page.close()
                    } catch (e) {}
                    return { meetingId, password }
                    // https://ghlsuccess.com/zoom
                } catch (e) {
                    console.error('error goto page: ', e)
                    throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
                }
            }
        } catch (e) {
            console.error('[parseMeetingUrl] invalid meeting url', e)
            throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
        }
    }
    getMeetingLink(
        meeting_id: string,
        password: string,
        role: number,
        bot_name: string,
    ) {
        return `${MEETINGJS_BASEURL}?meeting_id=${meeting_id}&password=${password}&role=${role}&name=${bot_name}`
    }
    async openMeetingPage(
        browser: puppeteer.Browser,
        link: string,
    ): Promise<puppeteer.Page> {
        const url = new URL(link)
        console.log({ url })
        const context = browser.defaultBrowserContext()
        await context.clearPermissionOverrides()
        await context.overridePermissions(url.origin, ['camera'])
        const page = await browser.newPage()
        await page.goto(link, { waitUntil: 'networkidle2' })
        return page
    }

    async joinMeeting(
        page: puppeteer.Page,
        cancelCheck: () => boolean,
        meetingParams: MeetingParams,
    ): Promise<void> {
        await sleep(1000)

        await clickJoinMeetingButton(page)

        while (true) {
            if (cancelCheck()) {
                throw new JoinError(JoinErrorCode.TimeoutWaitingToStart)
            }
            // meeting didnt start
            await bypass_modal(page)

            if (await joinAudio(page)) {
                break
            }
            await sleep(1000)
            //await joining()
        }

        // Send enter message in chat
        if (meetingParams.enter_message) {
            await sendEnterMessage(page, meetingParams.enter_message)
        }

        try {
            await joinCamera(page)
        } catch (e) {}
        if (meetingParams.recording_mode === 'galery_view') {
            try {
                console.log('gallery clicked', clickGalleryView(page))
            } catch (e) {}
        }
    }

    async findEndMeeting(
        meetingParams: MeetingParams,
        page: Page,
        cancellationToken: CancellationToken,
    ): Promise<boolean> {
        let element = null
        try {
            element = await findModal(page)
            const audio = await findJoinAudio(page)

            if (audio != null) {
                try {
                    try {
                        await this.joinMeeting(page, () => false, meetingParams)
                        console.log('meeting page joined')
                    } catch (error) {
                        console.error(error)
                    }
                } catch (e) {
                    console.log('joinMeeting after modal failed', e)
                }
            }
            if (element == null) {
                return false
            }
        } catch (e) {
            console.error('error in zoom join meeting, quitting', e)
            return true
        }
        let textContent = null
        try {
            textContent = await element.evaluate((el) => el.textContent)
        } catch (e) {
            console.log('[waitForEndMeeting] error in element evaluate', e)
        }

        console.log('[waitForEndMeeting] modale text content', {
            textContent,
        })

        if (element != null) {
            if (
                textContent === 'The meeting has been ended' ||
                textContent === 'You have been removed'
            ) {
                console.log(
                    '[waitForEndMeeting] the meeting has been ended found',
                )

                return true
            } else {
                console.log(
                    '[waitForEndMeeting] text content is not meeting has been ended, finding button',
                )
                await continueModal(page, 'waitForEndMeeting')
                await sleep(500)
            }
        }
        return false
    }
}

function parse(meeting_url: string) {
    const urlSplited = meeting_url.split(' ')[0]
    const url = new URL(urlSplited)
    const params = url.searchParams
    const meetingId = url.pathname.split('/')[2]

    let password = params.get('pwd')
    if (password == null) {
        try {
            const array = [...meeting_url.matchAll(/: (.*)\)/g)]
            password = array[0][1]
        } catch (e) {}
    }
    if (meetingId == null) {
        throw 'invalid meeting url'
    }
    return { meetingId, password }
}

const MEETINGJS_BASEURL = `http://localhost:3005`

async function clickJoinMeetingButton(page: puppeteer.Page) {
    const buttonJoinClicked = await page.$$eval('button', (elems) => {
        for (const e of elems) {
            let elem = e as any
            console.log({ elem })
            if (elem.innerText === 'Join') {
                elem.click()
                return true
            }
        }
        return false
    })
    console.log({ buttonJoinClicked })
}

async function bypass_modal(page: puppeteer.Page) {
    try {
        console.log('[joinMeeting] try to find modal')
        let element = await findModal(page)
        if (element != null) {
            console.log('[joinMeeting] found modal clicking')
            await continueModal(page, 'joinMeeting')
        } else {
            console.log('[joinMeeting] modale not found')
        }
    } catch (e) {
        console.log('[joinMeeting] error finding modale')
    }
}

async function clickJoinAudio(page: puppeteer.Page) {
    try {
        const [button] = await page.$x(
            "//button[contains(., 'Join Audio by Computer')]",
        )
        if (
            button &&
            button._remoteObject.description ===
                'button.zm-btn.join-audio-by-voip__join-btn.zm-btn--primary.zm-btn__outline--white.zm-btn--lg'
        ) {
            console.log('see join audio button')

            await button.click()
            await sleep(500)
            return true
        } else if (
            button &&
            button._remoteObject.description ===
                'button.zm-btn.join-audio-by-voip__join-btn.zm-btn--brown.zm-btn__outline--white.zm-btn--lg'
        ) {
            console.log('see leave audio button')
            const selectorClose =
                '.zm-btn.join-dialog__close.zm-btn--default.zm-btn__outline--blue'
            await page.waitForSelector(selectorClose)
            await page.click(selectorClose)
            await sleep(100)
            return true
        }
    } catch (e) {
        if (!(e instanceof puppeteer.errors.TimeoutError)) {
            console.log(`in wait for audio timeout: ${e}`)
        } else {
            console.log(`error in wait button join audio ${e}`)
        }
    }
    return false
}
async function clickGalleryView(page: Page) {
    for (const i of Array(10).keys()) {
        const clicked = await page.evaluate(() => {
            try {
                // Trouver l'élément en utilisant l'attribut aria-label
                var element = document.querySelector(
                    'a[aria-label="Gallery View"]',
                )

                // Vérifier si l'élément existe
                if (element) {
                    // Cliquer sur l'élément
                    ;(element as any).click()
                    return true
                } else {
                    console.log('Element not found.')
                }
            } catch (e) {}
            return false
        })
        if (clicked) {
            return true
        }
    }
    return false
}

async function joinAudio(page: puppeteer.Page) {
    await screenshot(page, `findJoinAudio`)
    let audioButtonClicked = false
    for (let i = 0; i < 10; i++) {
        if (await clickJoinAudio(page)) {
            if (audioButtonClicked) {
                console.log('there still was the join audio button', i)
            }
            audioButtonClicked = true
            await sleep(1000)
        } else {
            // if can't click on button and the button was cliced return true
            if (audioButtonClicked) {
                return true
            } else {
                break
            }
        }
    }
    if (audioButtonClicked) {
        throw new JoinError(JoinErrorCode.CannotJoinMeeting)
    } else {
        return false
    }
}

async function joinCamera(page: puppeteer.Page) {
    // const [button] = await page.$x("//button[contains(., 'Start Video')]")
    // await button.click();

    await sleep(1000)
    await screenshot(page, `beforeJoinCamera`)
    // while (true) {
    const clicked = await page.$$eval('button', (elems) => {
        for (const e of elems) {
            let elem = e as any
            if (elem.ariaLabel === 'start sending my video') {
                elem.click()
                return true
            }
        }
        return false
    })
    await screenshot(page, `afterJoinCamera`)
    console.log('looping', clicked)
    //     await sleep(1000)
    // }
}

async function sendEnterMessage(page: puppeteer.Page, message: string) {
    try {
        const CHAT_INPUT_SELECTOR = 'textarea.chat-box__chat-textarea'
        const CHAT_OPEN_BUTTON_SELECTOR =
            'button[aria-label="open the chat pane"]'
        const CHAT_CLOSE_BUTTON_SELECTOR =
            'button[aria-label="close the chat pane"]'
        const MORE_BUTTON_SELECTOR = 'button[aria-label="More meeting control"]'
        // selector for span with inner text Chat

        console.log(
            'fn clickFirst CHAT_CLOSE_BUTTON_SELECTOR',
            await clickFirst(page, CHAT_OPEN_BUTTON_SELECTOR),
        )
        await page.focus(CHAT_INPUT_SELECTOR)
        await page.keyboard.type(message)
        await page.type(CHAT_INPUT_SELECTOR, '\n')

        console.log(
            'fn clickFirst MORE_BUTTON_SELECTOR',
            await clickFirst(page, MORE_BUTTON_SELECTOR),
        )
        console.log(
            'fn click with inner text Chat',
            await clickWithInnerText(page, 'span', 'Chat'),
        )
    } catch (e) {
        console.error('Unable to send enter message in chat', e)
    }
}
async function clickFirst(
    page: Page,
    selector: string,
    retry: number = 5,
): Promise<boolean> {
    console.log(`clickFirst(${selector})`)
    for (let i = 0; i < retry; i++) {
        if (
            await page.$$eval(selector, (elems) => {
                for (const elem of elems) {
                    ;(elem as any).click()
                    return true
                }
                return false
            })
        ) {
            return true
        } else {
            await sleep(500)
        }
    }
    return false
}

async function findJoinAudio(
    page: puppeteer.Page,
): Promise<puppeteer.ElementHandle | undefined> {
    var element = null
    try {
        element = await page.waitForSelector(
            '.zm-btn.join-audio-by-voip__join-btn',
            { timeout: 500 },
        )
    } catch (e) {
        if (e instanceof puppeteer.errors.TimeoutError) {
            // console.log(`[find modal] timeout finding modale`)
            return undefined
        } else {
            console.log(`Faild to wait for selector ${e}`)
            throw e
        }
    }
    return element
}

async function findModal(
    page: Page,
): Promise<puppeteer.ElementHandle | undefined> {
    var element = null
    try {
        element = await page.waitForSelector('.zm-modal-body-title', {
            timeout: 500,
        })
    } catch (e) {
        if (e instanceof puppeteer.errors.TimeoutError) {
            // console.log(`[find modal] timeout finding modale`)
            return undefined
        } else {
            console.log(`Faild to wait for selector ${e}`)
        }
    }
    return element
}

async function continueModal(page: Page, functionName: string) {
    let element = null
    try {
        element = await page.waitForSelector(
            '.zm-btn--primary.zm-btn__outline--blue',
            { timeout: 500 },
        )
        if (element) {
            console.log(`[${functionName}] primary button found`)
            await element.click()
            return true
        }
    } catch (e) {
        try {
            console.log(
                `Failed to find zoom primary button trying other approach`,
            )

            element = await page.waitForSelector(
                'zmu-btn.zm-btn-legacy.zmu-btn--primary.zmu-btn__outline--blue',
                { timeout: 500 },
            )
            if (element) {
                console.log(`[${functionName}] legacy button found`)
                await element.click()
                return true
            }
        } catch (e) {
            console.log(
                `Failed to find zoom legacy button trying other approach`,
            )
        }
    }

    const [buttonContinue] = await page.$x("//button[contains(., 'Continue')]")
    try {
        if (buttonContinue) {
            console.log(`[${functionName}] button continue`, buttonContinue)
            await buttonContinue.click()
            return true
        }
    } catch (e) {
        console.log(`Failed to perform end meeting hook`)
    }

    const [buttonGotIt] = await page.$x("//button[contains(., 'Got it')]")
    try {
        if (buttonGotIt) {
            console.log(`[${functionName}] button got It`, buttonGotIt)
            await buttonGotIt.click()
            return true
        }
    } catch (e) {
        console.log(`Failed to perform end meeting hook`)
    }
    console.log(`[${functionName}] fail to find the button`)
    return false
}

export async function clickWithInnerText(
    page: puppeteer.Page,
    htmlType: string,
    innerText: string,
    iterations?: number,
    click: boolean = true,
): Promise<boolean> {
    let i = 0
    iterations = iterations ?? 10
    let continueButton = false

    while (!continueButton && (iterations == null || i < iterations)) {
        try {
            continueButton = await page.evaluate(
                (innerText, htmlType, i, click) => {
                    const elements = Array.from(
                        document.querySelectorAll(htmlType),
                    )
                    for (const e of elements) {
                        let elem = e as any
                        if (elem.innerText === innerText) {
                            if (click) {
                                elem.click()
                            }
                            return true
                        }
                    }
                    return false
                },
                innerText,
                htmlType,
                i,
                click,
            )
        } catch (e) {
            console.error('failed to find button', e)
        }
        await sleep(500)
        console.log(`${innerText} clicked:`, continueButton)
        i += 1
    }
    return continueButton
}
