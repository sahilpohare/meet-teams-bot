// src/urlParser/meetUrlParser.test.ts

import { JoinError } from '../meeting'
import {
    extractMeetCode,
    isMeetUrl,
    parseMeetingUrlFromJoinInfos,
} from './meetUrlParser'

describe('Meet URL Parser', () => {
    describe('Valid URLs', () => {
        const validUrls = [
            {
                name: 'standard Meet URL',
                url: 'https://meet.google.com/abc-defg-hij',
                expected: {
                    meetingId: 'https://meet.google.com/abc-defg-hij',
                    password: '',
                },
            },
            {
                name: 'Meet URL with query parameters',
                url: 'https://meet.google.com/abc-defg-hij?authuser=0',
                expected: {
                    meetingId:
                        'https://meet.google.com/abc-defg-hij?authuser=0',
                    password: '',
                },
            },
            {
                name: 'Meet URL without https',
                url: 'meet.google.com/abc-defg-hij',
                expected: {
                    meetingId: 'https://meet.google.com/abc-defg-hij',
                    password: '',
                },
            },
        ]

        test.each(validUrls)(
            'should parse $name correctly',
            async ({ url, expected }) => {
                const result = await parseMeetingUrlFromJoinInfos(url)
                expect(result).toEqual(expected)
            },
        )
    })

    describe('Invalid URLs', () => {
        const invalidUrls = [
            {
                name: 'empty URL',
                url: '',
            },
            {
                name: 'wrong domain',
                url: 'https://google.com/abc-defg-hij',
            },
            {
                name: 'invalid code format',
                url: 'https://meet.google.com/abcd-efgh-ijkl',
            },
            {
                name: 'missing code parts',
                url: 'https://meet.google.com/abc-defg',
            },
            {
                name: 'invalid characters in code',
                url: 'https://meet.google.com/123-4567-890',
            },
        ]

        test.each(invalidUrls)('should reject $name', async ({ url }) => {
            await expect(parseMeetingUrlFromJoinInfos(url)).rejects.toThrow(
                JoinError,
            )
        })
    })

    describe('Utility Functions', () => {
        describe('isMeetUrl', () => {
            it('should identify Meet URLs correctly', () => {
                expect(isMeetUrl('https://meet.google.com/abc-defg-hij')).toBe(
                    true,
                )
                expect(isMeetUrl('https://zoom.us/j/123456')).toBe(false)
            })
        })

        describe('extractMeetCode', () => {
            it('should extract Meet codes correctly', () => {
                expect(
                    extractMeetCode('https://meet.google.com/abc-defg-hij'),
                ).toBe('abc-defg-hij')
                expect(extractMeetCode('https://meet.google.com/invalid')).toBe(
                    null,
                )
            })
        })
    })
})
