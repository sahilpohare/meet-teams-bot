import * as puppeteer from 'puppeteer'
import { Page } from 'puppeteer'
import { CURRENT_MEETING, MeetingParams } from '../meeting'
import { screenshot } from '../puppeteer'
import { sleep } from '../utils'

const url_parse = require('url-parse')

export async function parseMeetingUrl(
    browser: puppeteer.Browser,
    meeting_url: string,
) {
    if (meeting_url.startsWith('https://www.google.com')) {
        try {
            const url = url_parse(meeting_url, true)
            const q = url.query.q
            console.log({ q })
            const { meetingId, password } = parse(q)
            return { meetingId, password }
        } catch (e) {
            console.error('[parseMeetingUrl] parse meeting url', e)
            throw 'invalid meeting url'
        }
    }
    try {
        try {
            const { meetingId, password } = parse(meeting_url)
            if (!(/^\d+$/.test(meetingId) || meetingId === '')) {
                throw 'invalid meetingId'
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
                throw 'invalid meeting url'
            }
        }
    } catch (e) {
        console.error('[parseMeetingUrl] invalid meeting url', e)
        throw 'invalid meeting url'
    }
}

function parse(meeting_url: string) {
    const urlSplited = meeting_url.split(' ')[0]
    const url = url_parse(urlSplited, true)
    const meetingId = url.pathname.split('/')[2]

    let password = url.query.pwd
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

export async function openMeetingPage(
    browser: puppeteer.Browser,
    link: string,
): Promise<puppeteer.Page> {
    const url = url_parse(link, true)
    console.log({ url })
    const context = browser.defaultBrowserContext()
    await context.clearPermissionOverrides()
    await context.overridePermissions(url.origin, ['camera'])
    const page = await browser.newPage()
    await page.goto(link, { waitUntil: 'networkidle2' })
    return page
}

export function getMeetingLink(
    meeting_id: string,
    password: string,
    role: number,
    bot_name: string,
) {
    return `${MEETINGJS_BASEURL}?meeting_id=${meeting_id}&password=${password}&role=${role}&name=${bot_name}`
}

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
        CURRENT_MEETING.logger.info('[joinMeeting] try to find modal')
        let element = await findModal(page)
        if (element != null) {
            CURRENT_MEETING.logger.info('[joinMeeting] found modal clicking')
            await continueModal(page, 'joinMeeting')
        } else {
            CURRENT_MEETING.logger.info('[joinMeeting] modale not found')
        }
    } catch (e) {
        CURRENT_MEETING.logger.error('[joinMeeting] error finding modale')
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
            CURRENT_MEETING.logger.info('see join audio button')

            await button.click()
            await sleep(500)
            return true
        } else if (
            button &&
            button._remoteObject.description ===
                'button.zm-btn.join-audio-by-voip__join-btn.zm-btn--brown.zm-btn__outline--white.zm-btn--lg'
        ) {
            CURRENT_MEETING.logger.info('see leave audio button')
            const selectorClose =
                '.zm-btn.join-dialog__close.zm-btn--default.zm-btn__outline--blue'
            await page.waitForSelector(selectorClose)
            await page.click(selectorClose)
            await sleep(100)
            return true
        }
    } catch (e) {
        if (!(e instanceof puppeteer.errors.TimeoutError)) {
            CURRENT_MEETING.logger.info(`in wait for audio timeout: ${e}`)
        } else {
            CURRENT_MEETING.logger.info(`error in wait button join audio ${e}`)
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
                CURRENT_MEETING.logger.error(
                    'there still was the join audio button',
                    i,
                )
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
    return audioButtonClicked
}

async function joining(page: puppeteer.Page) {
    try {
        const joinFound = await page.$$eval('button', (elems) => {
            for (const e of elems) {
                let elem = e as any
                if (elem.innerText === 'joining') {
                    elem.click()
                    return true
                }
            }
            return false
        })
    } catch (e) {
        if (!(e instanceof puppeteer.errors.TimeoutError)) {
            CURRENT_MEETING.logger.info(`wait for audio timeout: ${e}`)
        } else {
            CURRENT_MEETING.logger.info(`error in wait button joining ${e}`)
        }
    }
}

export async function joinMeeting(
    page: puppeteer.Page,
    meetingParams: MeetingParams,
    iterationsMax?: number,
): Promise<void> {
    await sleep(1000)

    await clickJoinMeetingButton(page)
    let waitingButton = false
    let i = 0
    while (true) {
        if (i > 60 * 15 || (iterationsMax != null && i > iterationsMax)) {
            throw 'timeout waiting for meeting to stat'
        }
        // meeting didnt start
        await bypass_modal(page)

        if (await joinAudio(page)) {
            break
        }
        await sleep(1000)
        //await joining()
    }
    try {
        await joinCamera(page)
    } catch (e) {}
    CURRENT_MEETING.logger.info('wait for camera done')
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
            // CURRENT_MEETING.logger.info(`[find modal] timeout finding modale`)
            return undefined
        } else {
            CURRENT_MEETING.logger.error(`Faild to wait for selector ${e}`)
            throw e
        }
    }
    return element
}

export async function waitForEndMeeting(
    meetingParams: MeetingParams,
    page: Page,
) {
    CURRENT_MEETING.logger.info('[waitForEndMeeting]')
    CURRENT_MEETING.logger.info(meetingParams.toString())

    while (CURRENT_MEETING && CURRENT_MEETING.status == 'Recording') {
        let element = null
        try {
            element = await findModal(page)
            const audio = await findJoinAudio(page)

            if (audio != null) {
                try {
                    await joinMeeting(page, meetingParams, 3)
                } catch (e) {
                    CURRENT_MEETING.logger.error(
                        'joinMeeting after modal failed',
                        e,
                    )
                }
            }
            if (element == null) {
                continue
            }
        } catch (e) {
            break
        }
        let textContent = null
        try {
            textContent = await element.evaluate((el) => el.textContent)
        } catch (e) {
            CURRENT_MEETING.logger.error(
                '[waitForEndMeeting] error in element evaluate',
                e,
            )
        }

        CURRENT_MEETING.logger.info('[waitForEndMeeting] modale text content', {
            textContent,
        })

        if (element != null) {
            if (
                textContent === 'The meeting has been ended' ||
                textContent === 'You have been removed'
            ) {
                CURRENT_MEETING.logger.info(
                    '[waitForEndMeeting] the meeting has been ended found',
                )

                break
            } else {
                CURRENT_MEETING.logger.info(
                    '[waitForEndMeeting] text content is not meeting has been ended, finding button',
                )
                if (await continueModal(page, 'waitForEndMeeting')) {
                    continue
                }
                await sleep(500)
            }
        }
    }
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
            // CURRENT_MEETING.logger.info(`[find modal] timeout finding modale`)
            return undefined
        } else {
            CURRENT_MEETING.logger.error(`Faild to wait for selector ${e}`)
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
            CURRENT_MEETING.logger.info(
                `[${functionName}] primary button found`,
            )
            await element.click()
            return true
        }
    } catch (e) {
        try {
            CURRENT_MEETING.logger.error(
                `Failed to find zoom primary button trying other approach`,
            )

            element = await page.waitForSelector(
                'zmu-btn.zm-btn-legacy.zmu-btn--primary.zmu-btn__outline--blue',
                { timeout: 500 },
            )
            if (element) {
                CURRENT_MEETING.logger.info(
                    `[${functionName}] legacy button found`,
                )
                await element.click()
                return true
            }
        } catch (e) {
            CURRENT_MEETING.logger.error(
                `Failed to find zoom legacy button trying other approach`,
            )
        }
    }

    const [buttonContinue] = await page.$x("//button[contains(., 'Continue')]")
    try {
        if (buttonContinue) {
            CURRENT_MEETING.logger.info(
                `[${functionName}] button continue`,
                buttonContinue,
            )
            await buttonContinue.click()
            return true
        }
    } catch (e) {
        CURRENT_MEETING.logger.error(`Failed to perform end meeting hook`)
    }

    const [buttonGotIt] = await page.$x("//button[contains(., 'Got it')]")
    try {
        if (buttonGotIt) {
            CURRENT_MEETING.logger.info(
                `[${functionName}] button got It`,
                buttonGotIt,
            )
            await buttonGotIt.click()
            return true
        }
    } catch (e) {
        CURRENT_MEETING.logger.error(`Failed to perform end meeting hook`)
    }
    CURRENT_MEETING.logger.info(`[${functionName}] fail to find the button`)
    return false
}
