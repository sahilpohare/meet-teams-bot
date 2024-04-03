import * as puppeteer from 'puppeteer'
import * as MeetProvider from './meeting/meet'
import * as TeamsProvider from './meeting/teams'
import * as ZoomProvider from './meeting/zoom'

import { Agenda, MeetingProvider } from 'spoke_api_js'
import { BrandingHandle, generateBranding, playBranding } from './branding'
import { Logger, uploadLog } from './logger'
import {
    findBackgroundPage,
    getCachedExtensionId,
    listenPage,
    openBrowser,
    removeListenPage,
} from './puppeteer'

import { Page } from 'puppeteer'
import { notifyApp } from './calendar'
import { Events } from './events'
import { delSessionInRedis } from './instance'
import { sleep } from './utils'

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
    logger: null,
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

export type SpeechToTextProvider = 'Gladia'

export type MeetingParams = {
    use_my_vocabulary: boolean
    language: string
    meeting_url: string
    user_token: string
    bot_name: string
    project_name: string
    user_id: number
    session_id: string
    email: string
    meetingProvider: MeetingProvider
    api_server_baseurl?: string
    api_bot_baseurl?: string
    event?: { id: number }
    agenda?: Agenda
    bot_branding: boolean
    has_installed_extension: boolean
    custom_branding_bot_path?: string
    vocabulary: string[]
    force_lang: boolean
    translation_lang?: string
    speech_to_text?: SpeechToTextProvider
    bot_id?: number
    enter_message?: string
    bots_api_key?: string
    bots_webhook_url?: string
    automatic_leave: {
        // The number of seconds after which the bot will automatically leave the call, if it has not been let in from the waiting room.
        waiting_room_timeout: number
        // The number of seconds after which the bot will automatically leave the call, if it has joined the meeting but no other participant has joined.
        noone_joined_timeout: number
        // The number of seconds after which the bot will automatically leave the call, if there were other participants in the call who have all left.
        // everyone_left_timeout?: number
        // The number of seconds after which the bot will automatically leave the call, if it has joined the call but not started recording.
        // in_call_not_recording_timeout?: number
        // The number of seconds after which the bot will automatically leave the call, if it has joined the call and started recording it. This can be used to enforce a maximum recording time limit for a bot. There is no default value for this parameter, meaning a bot will continue to record for as long as the meeting lasts.
        // in_call_recording_timeout?: number
        // The number of seconds after which the bot will automatically leave the call, if it has joined the call but has not started recording. For e.g This can occur due to bot being denied permission to record(Zoom meetings).
        // recording_permission_denied_timeout?: number
    }
}

function getMeetingGlobal(): Meeting | null {
    return CURRENT_MEETING.meeting
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
    setMeetingProvide(meetingParams.meetingProvider)
    CURRENT_MEETING.param = meetingParams
    CURRENT_MEETING.status = 'Recording'
    CURRENT_MEETING.logger = logger
}

function meetingTimeout() {
    CURRENT_MEETING.logger.info('stoping meeting tiemout reason')
    try {
        stopRecording('timeout')
    } catch (e) {
        console.error(e)
    }
    setTimeout(async () => {
        CURRENT_MEETING.logger.info('killing process')
        try {
            await uploadLog()
        } catch (e) {
            console.error(e)
        }
        process.exit(0)
    }, 5 * 60 * 1000)
}
// Starts the record
// Returns when the bot is accepted in the meeting

export class CancellationToken {
    isCancellationRequested: boolean
    timeInSec: number
    timeout: NodeJS.Timeout
    constructor(timeInSec: number) {
        this.isCancellationRequested = false
        this.timeInSec = timeInSec
        this.timeout = setTimeout(() => this.cancel(), this.timeInSec * 1000)
    }
    cancel() {
        this.isCancellationRequested = true
    }
    reset() {
        clearTimeout(this.timeout)
        this.timeout = setTimeout(() => this.cancel(), this.timeInSec * 1000)
    }
}

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
            () => {
                CURRENT_MEETING.logger.error('Meeting timeout')
                meetingTimeout()
            },
            4 * 60 * 60 * 1000, // 4 hours
        )

        await Events.inWaitingRoom()

        const waintingRoomToken = new CancellationToken(
            meetingParams.automatic_leave.waiting_room_timeout,
        )

        try {
            await MEETING_PROVIDER.joinMeeting(
                CURRENT_MEETING.meeting.page,
                waintingRoomToken,
                meetingParams,
            )
            CURRENT_MEETING.logger.info('meeting page joined')
        } catch (error) {
            console.error(error)
            throw error
        }

        listenPage(CURRENT_MEETING.meeting.backgroundPage)
        await Events.inCallNotRecording()

        meetingParams.api_server_baseurl = process.env.API_SERVER_BASEURL
        meetingParams.api_bot_baseurl = process.env.API_BOT_BASEURL

        const project = await CURRENT_MEETING.meeting.backgroundPage.evaluate(
            async (meetingParams) => {
                const w = window as any
                return await w.startRecording(meetingParams)
            },
            { ...meetingParams, s3_bucket: process.env.AWS_S3_BUCKET },
        )
        CURRENT_MEETING.logger.info('startRecording called')

        await Events.inCallRecording()

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
        new CancellationToken(
            CURRENT_MEETING.param.automatic_leave.noone_joined_timeout,
        ),
    )

    CURRENT_MEETING.logger.info('after waitForEndMeeting')
    await Events.callEnded()

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
            await page.goto('about:blank')
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
