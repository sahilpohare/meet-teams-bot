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
import { delSessionInRedis } from './instance'
import { Agenda, Note, MeetingProvider } from 'spoke_api_js'
import { Logger, uploadLog } from './logger'

import * as TeamsProvider from './meeting/teams'
import * as ZoomProvider from './meeting/zoom'
import * as MeetProvider from './meeting/meet'
import { BrandingHandle, generateBranding, playBranding } from './branding'

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
    meeting: {
        page: null,
        backgroundPage: null,
        browser: null,
        meetingTimeoutInterval: null,
        session_id: null,
    },
    param: null,
    status: null,
    project: null,
    error: null,
    logger: new Logger({ owner_id: -1 }),
    brandingGenerateProcess: null,
    brandingPlayProcess: null,
}

type MeetingHandle = {
    logger: Logger
    status: MeetingStatus
    project: { id: number } | null
    error: any | null
    meeting: Meeting | null
    param: MeetingParams | null
    brandingGenerateProcess: BrandingHandle | null
    brandingPlayProcess: BrandingHandle | null
}

type MeetingStatus = 'Recording' | 'Cleanup' | 'Done'

type Meeting = {
    page: Page
    backgroundPage: Page
    browser: puppeteer.Browser
    meetingTimeoutInterval: NodeJS.Timeout
    session_id: string
}
type Session = {
    meeting_url: string
    user_id: number
}

export type StatusParams = {
    meeting_url: string
    user_id: number
}

export type BotBrandingType = 'none' | 'default' | 'custom' | 'favicon'

export type MeetingParams = {
    use_my_vocabulary: boolean
    language: string
    meeting_url: string
    user_token: string
    project_name: string
    user_id: number
    session_id: string
    email: string
    meetingProvider: MeetingProvider
    api_server_baseurl?: string
    api_bot_baseurl?: string
    event?: { id: number }
    agenda?: Agenda
    has_installed_extension: boolean
    vocabulary: string[]
    bot_name: string
    bot_branding: boolean
    custom_branding_bot_path?: string
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

export function unsetMeetingGlobal() {
    CURRENT_MEETING.logger.info(`Deregistering meeting`)
    CURRENT_MEETING.meeting = {
        page: null,
        backgroundPage: null,
        browser: null,
        meetingTimeoutInterval: null,
        session_id: null,
    }
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
    CURRENT_MEETING.param = meetingParams
    CURRENT_MEETING.status = 'Recording'
    CURRENT_MEETING.logger = logger
}

// Starts the record
// Returns when the bot is accepted in the meeting
export async function startRecordMeeting(meetingParams: MeetingParams) {
    CURRENT_MEETING.param = meetingParams

    try {
        if (meetingParams.bot_branding) {
            CURRENT_MEETING.brandingGenerateProcess = generateBranding(
                meetingParams.bot_name,
                meetingParams.custom_branding_bot_path,
            )
            await CURRENT_MEETING.brandingGenerateProcess.wait
            CURRENT_MEETING.brandingPlayProcess = playBranding()
        }

        const extensionId = await getCachedExtensionId()
        CURRENT_MEETING.meeting.browser = await openBrowser(extensionId)
        CURRENT_MEETING.meeting.backgroundPage = await findBackgroundPage(
            CURRENT_MEETING.meeting.browser,
            extensionId,
        )
        CURRENT_MEETING.logger.info('Extension found', { extensionId })

        const { meetingId, password } = await MEETING_PROVIDER.parseMeetingUrl(
            CURRENT_MEETING.meeting.browser,
            meetingParams.meeting_url,
        )
        CURRENT_MEETING.logger.info('meeting id found', { meetingId })

        const meetingLink = MEETING_PROVIDER.getMeetingLink(
            meetingId,
            password,
            0,
            meetingParams.bot_name,
        )
        CURRENT_MEETING.logger.info('Meeting link found', { meetingLink })

        CURRENT_MEETING.meeting.page = await MEETING_PROVIDER.openMeetingPage(
            CURRENT_MEETING.meeting.browser,
            meetingLink,
        )
        CURRENT_MEETING.logger.info('meeting page opened')

        CURRENT_MEETING.meeting.meetingTimeoutInterval = setTimeout(
            () => stopRecording('timeout'),
            4 * 60 * 60 * 1000, // 4 hours
        )

        await MEETING_PROVIDER.joinMeeting(
            CURRENT_MEETING.meeting.page,
            meetingParams,
        )
        CURRENT_MEETING.logger.info('meeting page joined')
        listenPage(CURRENT_MEETING.meeting.backgroundPage)

        meetingParams.api_server_baseurl = process.env.API_SERVER_BASEURL
        meetingParams.api_bot_baseurl = process.env.API_BOT_BASEURL

        const project = await CURRENT_MEETING.meeting.backgroundPage.evaluate(
            async (meetingParams) => {
                const w = window as any
                return await w.startRecording(meetingParams)
            },
            meetingParams,
        )
        CURRENT_MEETING.logger.info('startRecording called')

        if (project == null) {
            throw 'failed creating project'
        }

        CURRENT_MEETING.project = project
        return project
    } catch (e) {
        console.error('an error occured while starting recording', e)
        console.error('setting current_meeting error')
        CURRENT_MEETING.error = e
        console.error('after set current meeting error')
        await cleanEverything(true)
        throw e
    }
}

async function cleanEverything(failed: boolean) {
    try {
        await uploadLog()
    } catch (e) {
        CURRENT_MEETING.logger.error(`failed to upload logs: ${e}`)
    }
    try {
        CURRENT_MEETING.brandingGenerateProcess?.kill()
        CURRENT_MEETING.brandingPlayProcess?.kill()
    } catch (e) {
        CURRENT_MEETING.logger.error(`failed to kill process: ${e}`)
    }
    await cleanMeeting(CURRENT_MEETING.meeting)
    try {
        await delSessionInRedis(CURRENT_MEETING.param.session_id)
    } catch (e) {
        CURRENT_MEETING.logger.error(`failed to del session in redis: ${e}`)
    }
}

export async function recordMeetingToEnd() {
    await MEETING_PROVIDER.waitForEndMeeting(
        CURRENT_MEETING.param,
        CURRENT_MEETING.meeting.page,
    )
    CURRENT_MEETING.logger.info('after waitForEndMeeting')

    try {
        await stopRecordingInternal(CURRENT_MEETING.param)
    } catch (e) {
        CURRENT_MEETING.logger.error(`Failed to stop recording: ${e}`)
    } finally {
        await cleanEverything(false)
    }
}
export type ChangeAgendaRequest = {
    agenda_id: number
}

export type ChangeLanguage = {
    meeting_url: string
    use_my_vocabulary: boolean
    language: string
    user_id: number
}

export async function getAgenda(): Promise<Agenda | undefined> {
    const meeting = getMeetingGlobal()
    if (meeting != null) {
        const agenda = await CURRENT_MEETING.meeting.backgroundPage.evaluate(
            async () => {
                const w = window as any
                return await w.getAgenda()
            },
        )
        return agenda
    } else {
        CURRENT_MEETING.logger.error("Can't get agenda")
        return undefined
    }
}

export async function changeAgenda(data: ChangeAgendaRequest) {
    const meeting = getMeetingGlobal()
    if (meeting != null) {
        CURRENT_MEETING.logger.info('Changing agenda', {
            new_agenda: data.agenda_id,
        })
        await CURRENT_MEETING.meeting.backgroundPage.evaluate(async (data) => {
            const w = window as any
            await w.changeAgenda(data)
        }, data)
    } else {
        CURRENT_MEETING.logger.error(
            "Can't change language, the meeting has ended",
        )
    }
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
                { session_id: CURRENT_MEETING.param.session_id },
            )
        } catch (e) {}
        let { page, meetingTimeoutInterval, browser, backgroundPage } = meeting
        await backgroundPage.evaluate(async () => {
            const w = window as any
            await w.stopMediaRecorder()
        })
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
