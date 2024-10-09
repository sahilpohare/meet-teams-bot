import * as puppeteer from 'puppeteer'

import { JoinError, JoinErrorCode } from '../meeting'

import { ZoomProvider } from '../meeting/zoom'

export class ZoomProviderMock extends ZoomProvider {
    async parseMeetingUrl(
        _browser: puppeteer.Browser | null,
        meeting_url: string,
    ) {
        try {
            const { meetingId, password } = this.parse(meeting_url)
            if (!(/^\d+$/.test(meetingId) || meetingId === '')) {
                throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
            }
            return { meetingId, password }
        } catch (e) {
            throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
        }
    }
}
