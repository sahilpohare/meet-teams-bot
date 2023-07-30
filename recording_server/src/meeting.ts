import * as puppeteer from 'puppeteer'
import { notifyApp } from './calendar'
import { Page } from 'puppeteer'
import {
    openBrowser,
    findBackgroundPage,
    listenPage,
    removeListenPage,
    getCachedExtensionId,
} from './puppeteer'
import { sleep } from './utils'
import { setProtection, unlockInstance, detachZoomSession } from './instance'
import { Agenda, Note, MeetingProvider } from 'spoke_api_js'
import { Logger, uploadLog } from './logger'

import * as TeamsProvider from './meeting/teams'
import * as ZoomProvider from './meeting/zoom'
import * as MeetProvider from './meeting/meet'
import { generateBranding, playBranding } from './branding'

function detectMeetingProvider(url: string) {
    if (url.includes('https://teams')) {
        return 'Teams'
    } else if (url.includes('https://meet')) {
        return 'Meet'
    } else {
        return 'Zoom'
    }
}
function setMeetingProvide(meetingProvider: MeetingProvider) {
    if (meetingProvider === 'Teams') {
        MEETING_PROVIDER = {
            openMeetingPage: TeamsProvider.openMeetingPage,
            joinMeeting: TeamsProvider.joinMeeting,
            waitForEndMeeting: TeamsProvider.waitForEndMeeting,
            parseMeetingUrl: TeamsProvider.parseMeetingUrl,
            getMeetingLink: TeamsProvider.getMeetingLink,
        }
    } else if (meetingProvider === 'Meet') {
        MEETING_PROVIDER = {
            openMeetingPage: MeetProvider.openMeetingPage,
            joinMeeting: MeetProvider.joinMeeting,
            waitForEndMeeting: MeetProvider.waitForEndMeeting,
            parseMeetingUrl: MeetProvider.parseMeetingUrl,
            getMeetingLink: MeetProvider.getMeetingLink,
        }
    } else {
        MEETING_PROVIDER = {
            openMeetingPage: ZoomProvider.openMeetingPage,
            joinMeeting: ZoomProvider.joinMeeting,
            waitForEndMeeting: ZoomProvider.waitForEndMeeting,
            parseMeetingUrl: ZoomProvider.parseMeetingUrl,
            getMeetingLink: ZoomProvider.getMeetingLink,
        }
    }
}

let MEETING_PROVIDER = {
    openMeetingPage: ZoomProvider.openMeetingPage,
    joinMeeting: ZoomProvider.joinMeeting,
    waitForEndMeeting: ZoomProvider.waitForEndMeeting,
    parseMeetingUrl: ZoomProvider.parseMeetingUrl,
    getMeetingLink: ZoomProvider.getMeetingLink,
}

export const CURRENT_MEETING: MeetingHandle = {
    meeting: null,
    param: null,
    status: null,
    project: null,
    error: null,
    logger: new Logger({ owner_id: -1 }),
}

type MeetingHandle = {
    logger: Logger
    status: MeetingStatus
    project: { id: number } | null
    error: any | null
    meeting: Meeting | null
    param: MeetingParams | null
}

type MeetingStatus = 'Recording' | 'Cleanup' | 'Done'

type Meeting = {
    page: Page
    backgroundPage: Page
    intervalId: NodeJS.Timeout
    browser: puppeteer.Browser
    meetingTimeoutInterval: NodeJS.Timeout
    api_session_id: string
}
type Session = {
    meeting_url: string
    user_id: number
}

export type StatusParams = {
    meeting_url: string
    user_id: number
}

export type MeetingParams = {
    human_transcription: boolean
    use_my_vocabulary: boolean
    language: string
    meeting_url: string
    user_token: string
    bot_name: string
    project_name: string
    user_id: number
    api_session_id: string
    email: string
    meetingProvider: MeetingProvider
    api_server_baseurl?: string
    api_download_baseurl?: string
    event?: { id: number }
    rev_api_key: string
    agenda?: Agenda
    bot_branding: boolean
    has_installed_extension: boolean
    custom_branding_bot_path: string
}

export type MarkMomentParams = {
    meeting_url: string
    user_id: number
    label_id?: number
    duration?: number
    notes?: Note[]
}

function getMeetingGlobal(): Meeting | null {
    return CURRENT_MEETING.meeting
}

function setMeetingGlobal(
    param: MeetingParams,
    data: Meeting | null,
    logger: Logger,
) {
    CURRENT_MEETING.meeting = data
    CURRENT_MEETING.param = param
    CURRENT_MEETING.status = 'Recording'
    CURRENT_MEETING.logger = logger
}

export function unsetMeetingGlobal() {
    CURRENT_MEETING.logger.info(`Deregistering meeting`)
    CURRENT_MEETING.meeting = null
    CURRENT_MEETING.param = null
    CURRENT_MEETING.status = null
    CURRENT_MEETING.error = null
    CURRENT_MEETING.project = null
}

async function cleanMeeting(meeting: Meeting) {
    CURRENT_MEETING.logger.info(`Cleaning old meeting`)
    // try { removeListenPage(meeting.backgroundPage) } catch (e) { console.error(e) }
    try {
        await meeting.page.close()
    } catch (e) {
        console.error(e)
    }
    try {
        await meeting.backgroundPage.close()
    } catch (e) {
        console.error(e)
    }
    try {
        await meeting.browser.close()
    } catch (e) {
        console.error(e)
    }
    try {
        clearTimeout(meeting.intervalId)
    } catch (e) {
        console.error(e)
    }
    try {
        clearTimeout(meeting.meetingTimeoutInterval)
    } catch (e) {
        console.error(e)
    }
}

export function setInitalParams(meetingParams: MeetingParams, logger: Logger) {
    meetingParams.meetingProvider = detectMeetingProvider(
        meetingParams.meeting_url,
    )
    unsetMeetingGlobal()
    setMeetingProvide(meetingParams.meetingProvider)
    setMeetingGlobal(meetingParams, null, logger)
}

export async function recordMeeting(meetingParams: MeetingParams) {
    let page: puppeteer.Page
    let backgroundPage: puppeteer.Page
    let browser: puppeteer.Browser
    let meetingTimeoutInterval: NodeJS.Timeout
    let intervalId: NodeJS.Timeout
    let api_session_id = meetingParams.api_session_id
    let brandingGenerateProcess
    let brandingPlayProcess
    try {
        let start = Date.now()
        if (
            meetingParams.bot_branding ||
            meetingParams.custom_branding_bot_path
        ) {
            brandingGenerateProcess = await generateBranding(
                meetingParams.bot_name,
                meetingParams.custom_branding_bot_path,
            ).wait

            console.log(
                `Execution time (generate_branding): ${Date.now() - start} ms`,
            )
            start = Date.now()
            brandingPlayProcess = playBranding()
            console.log(
                `Execution time (generate_branding): ${Date.now() - start} ms`,
            )
        }
        start = Date.now()
        const extensionId = await getCachedExtensionId()
        console.log(
            `Execution time (getCachedExtensionId): ${Date.now() - start} ms`,
        )
        start = Date.now()
        browser = await openBrowser(extensionId)
        console.log(`Execution time (openBrowser): ${Date.now() - start} ms`)
        start = Date.now()
        backgroundPage = await findBackgroundPage(browser, extensionId)
        console.log(
            `Execution time (findBackgroundPage): ${Date.now() - start} ms`,
        )
        start = Date.now()
        CURRENT_MEETING.logger.info('Extension found', { extensionId })

        const { meetingId: meeting_id, password } =
            await MEETING_PROVIDER.parseMeetingUrl(
                browser,
                meetingParams.meeting_url,
            )
        CURRENT_MEETING.logger.info('meeting id found', { meeting_id })

        const meetingLink = MEETING_PROVIDER.getMeetingLink(
            meeting_id,
            password,
            0,
            meetingParams.bot_name,
        )
        CURRENT_MEETING.logger.info('Meeting link found', { meetingLink })
        page = await MEETING_PROVIDER.openMeetingPage(browser, meetingLink)
        console.log(
            `Execution time (openMeetingPage): ${Date.now() - start} ms`,
        )
        let i = 0
        intervalId = setInterval(() => {
            i++
        }, 10000)
        meetingTimeoutInterval = setTimeout(
            () => stopRecording('timeout'),
            4 * 60 * 60 * 1000,
        )
        setMeetingGlobal(
            meetingParams,
            {
                page,
                backgroundPage,
                intervalId,
                browser,
                meetingTimeoutInterval,
                api_session_id,
            },
            CURRENT_MEETING.logger,
        )
        await MEETING_PROVIDER.joinMeeting(page, meetingParams)
        listenPage(backgroundPage)

        meetingParams.api_server_baseurl = process.env.API_SERVER_BASEURL
        meetingParams.api_download_baseurl = process.env.API_DOWNLOAD_BASEURL
        meetingParams.rev_api_key = process.env.REV_API_KEY
        console.log({ meetingParams })
        const project = await backgroundPage.evaluate(async (meetingParams) => {
            const w = window as any
            return await w.startRecording(meetingParams)
            // w.startRecordingTest()
        }, meetingParams)
        recordMeetingToEnd(page, meetingParams, cleanEverything)
        if (project == null) {
            throw 'failed creating project'
        }
        CURRENT_MEETING.project = project
        return project
    } catch (e) {
        console.error('setting current_meeting error')
        CURRENT_MEETING.error = e
        console.error('after set curent meeting error')
        await cleanEverything(true)
        throw e
    }
    async function cleanEverything(failed: boolean) {
        console.log(failed)
        try {
            await uploadLog()
        } catch (e) {
            CURRENT_MEETING.logger.error(`failed to upload logs: ${e}`)
        }
        try {
            brandingGenerateProcess?.kill()
            brandingPlayProcess?.kill()
        } catch (e) {
            CURRENT_MEETING.logger.error(`failed to kill process: ${e}`)
        }
        await cleanMeeting({
            page,
            backgroundPage,
            browser,
            intervalId,
            meetingTimeoutInterval,
            api_session_id,
        })
        try {
            await setProtection(false)
        } catch (e) {
            CURRENT_MEETING.logger.error(`failed to unset protection: ${e}`)
        }
        try {
            await unlockInstance()
        } catch (e) {
            CURRENT_MEETING.logger.error(`failed to unlock instance: ${e}`)
        }
    }
}

export async function recordMeetingToEnd(
    page: Page,
    meetingParams: MeetingParams,
    cleanEverything: (failed: boolean) => Promise<void>,
) {
    await MEETING_PROVIDER.waitForEndMeeting(meetingParams, page)
    CURRENT_MEETING.logger.info('after waitForEndMeeting')
    try {
        await stopRecordingInternal(meetingParams)
    } catch (e) {
        CURRENT_MEETING.logger.error(`Failed to stop recording: ${e}`)
    } finally {
        try {
            await detachZoomSession(meetingParams.api_session_id)
        } catch (e) {
            CURRENT_MEETING.logger.error(`Detach zoom session failed: ${e}`)
        }
        await cleanEverything(false)
    }
}

export type ChangeLanguage = {
    meeting_url: string
    human_transcription: boolean
    use_my_vocabulary: boolean
    language: string
    user_id: number
}

export async function changeLanguage(data: ChangeLanguage) {
    const meeting = getMeetingGlobal()
    if (meeting != null) {
        CURRENT_MEETING.logger.info('Changing language', {
            new_language: data.language,
        })
        // CURRENT_MEETING.logger.error('Can\'t change language, the feature is desactivated')
        let { backgroundPage } = meeting
        await backgroundPage.evaluate(async (data) => {
            const w = window as any
            await w.changeLanguage(data)
        }, data)
    } else {
        CURRENT_MEETING.logger.error(
            "Can't change language, the meeting has ended",
        )
    }
}

export type StopRecordParams = {
    meeting_url: string
    user_id: number
}

export async function stopRecording(reason: string) {
    if (CURRENT_MEETING.status == null) {
        CURRENT_MEETING.logger.error(
            `Can't exit metting, there is no pending meeting`,
            { exit_reason: reason },
        )
        return
    } else if (CURRENT_MEETING.status != 'Recording') {
        CURRENT_MEETING.logger.error(
            `Can't exit metting, the meeting is not in recording state`,
            { status: CURRENT_MEETING.status, exit_reason: reason },
        )
        return
    }
    CURRENT_MEETING.status = 'Cleanup'
    CURRENT_MEETING.logger.info(`Stop recording scheduled`, {
        exit_reason: reason,
    })
}

async function stopRecordingInternal(param: Session) {
    const meeting = getMeetingGlobal()
    if (meeting != null) {
        try {
            await notifyApp(
                'EndRecording',
                CURRENT_MEETING.param,
                {},
                { session_id: CURRENT_MEETING.param.api_session_id },
            )
        } catch (e) {}
        let {
            page,
            meetingTimeoutInterval,
            intervalId,
            browser,
            backgroundPage,
        } = meeting
        await backgroundPage.evaluate(async () => {
            const w = window as any
            await w.stopMediaRecorder()
        })
        try {
            clearTimeout(intervalId)
        } catch (e) {
            console.error(e)
        }
        try {
            clearTimeout(meetingTimeoutInterval)
        } catch (e) {
            console.error(e)
        }
        try {
            await page.close()
        } catch (e) {
            CURRENT_MEETING.logger.error(`Failed to close page: ${e}`)
        }

        CURRENT_MEETING.logger.info('Waiting for all chunks to be uploaded')
        await backgroundPage.evaluate(async () => {
            const w = window as any
            await w.waitForUpload()
        })
        CURRENT_MEETING.logger.info('All chunks uploaded')
        // browser.disconnect()
        try {
            removeListenPage(backgroundPage)
            await backgroundPage.close()
            await sleep(1)
            await browser.close()
        } catch (e) {
            console.error(`Failed to close browser: ${e}`)
        }
        CURRENT_MEETING.logger.info('Meeting successfully terminated')
    } else {
        CURRENT_MEETING.logger.error('Meeting already ended')
    }
}

export async function markMoment(markMomentParams: MarkMomentParams) {
    const meeting = getMeetingGlobal()
    console.log('[markMoment]')
    if (meeting != null) {
        let backgroundPage = meeting.backgroundPage
        await backgroundPage.evaluate((markMomentParams) => {
            const w = window as any
            //TODO: what if the computer is not in time
            const timestamp = new Date().getTime()
            w.markMoment(
                timestamp,
                markMomentParams.duration,
                markMomentParams.label_id,
                markMomentParams.notes,
            )
        }, markMomentParams)
    }
}
