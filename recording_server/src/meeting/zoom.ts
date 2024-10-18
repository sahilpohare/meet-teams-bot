import * as puppeteer from 'puppeteer'

import { JoinError, JoinErrorCode } from '../meeting'
import {
    CancellationToken,
    MeetingParams,
    MeetingProviderInterface,
    RecordingApprovalState,
} from '../types'

import { Page } from 'puppeteer'
import { URL } from 'url'
import { sleep } from '../utils'

let IS_ZOOOM_RECORDING_APPROVED: RecordingApprovalState =
    RecordingApprovalState.WAITING

export const ZOOM_RECORDING_APPROVAL_STATUS = {
    get: (): RecordingApprovalState => IS_ZOOOM_RECORDING_APPROVED,
    set: (value: RecordingApprovalState) => {
        IS_ZOOOM_RECORDING_APPROVED = value
    },
}

const MEETINGJS_BASEURL = `http://localhost:3005`

export class ZoomProvider implements MeetingProviderInterface {
    constructor() {}
    async parseMeetingUrl(browser: puppeteer.Browser, meeting_url: string) {
        if (meeting_url.startsWith('https://www.google.com')) {
            console.warn('URL with google.com')
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
        message?: string,
    ) {
        return `${MEETINGJS_BASEURL}?meeting_id=${meeting_id}&password=${password}&role=${role}&name=${bot_name}&message=${encodeURIComponent(
            message,
        )}`
    }

    async openMeetingPage(
        browser: puppeteer.Browser,
        link: string,
        streaming_input: string | undefined,
    ): Promise<puppeteer.Page> {
        const url = new URL(link)
        console.log({ url })

        const context = browser.defaultBrowserContext()
        await context.clearPermissionOverrides()
        if (streaming_input) {
            await context.overridePermissions(url.origin, [
                'microphone',
                'camera',
            ])
        } else {
            await context.overridePermissions(url.origin, ['camera'])
        }
        const page = await browser.newPage()

        await page
            .target()
            .createCDPSession()
            .then(async (session) => {
                await session.send('Browser.grantPermissions', {
                    origin: url.origin,
                    permissions: ['audioCapture', 'videoCapture'],
                })
            })

        await page.goto(link, { waitUntil: 'networkidle2' })
        return page
    }

    async joinMeeting(
        page: puppeteer.Page,
        cancelCheck: () => boolean,
        meetingParams: MeetingParams,
    ): Promise<void> {
        console.log(
            '#### meuh [joinMeeting] - zoom - waiting approval',
            ZOOM_RECORDING_APPROVAL_STATUS.get(),
        )
        while (
            ZOOM_RECORDING_APPROVAL_STATUS.get() ===
            RecordingApprovalState.WAITING
        ) {
            console.log(
                '[joinMeeting] - zoom - waiting approval',
                ZOOM_RECORDING_APPROVAL_STATUS.get(),
                IS_ZOOOM_RECORDING_APPROVED,
            )
            await sleep(1000)
        }
        if (
            ZOOM_RECORDING_APPROVAL_STATUS.get() ===
            RecordingApprovalState.DISABLE
        ) {
            throw new Error('Recording approval is not granted')
        }
        if (
            ZOOM_RECORDING_APPROVAL_STATUS.get() ===
            RecordingApprovalState.ENABLE
        ) {
            console.log('[joinMeeting] - zoom - approval granted')
            return
        }
    }

    //This function is not used for zoom
    async findEndMeeting(
        meetingParams: MeetingParams,
        page: Page,
        cancellationToken: CancellationToken,
    ): Promise<boolean> {
        //TODO COMUNICATE WITH THE SERVER TO FIND THE END MEETING BUTTON
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
    console.log('ZOOM PARSING MeetingId and password', { meetingId, password })
    return { meetingId, password }
}
