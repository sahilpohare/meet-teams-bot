import { Browser } from 'puppeteer'
import { JoinError } from '../meeting'
import { parseMeetingUrlFromJoinInfos } from './zoomUrlParser'

describe('Zoom URL Parser', () => {
    let mockBrowser: jest.Mocked<Browser>

    beforeEach(() => {
        mockBrowser = {
            newPage: jest.fn().mockResolvedValue({
                goto: jest.fn().mockResolvedValue(undefined),
                url: jest.fn(),
                close: jest.fn().mockResolvedValue(undefined),
            }),
        } as unknown as jest.Mocked<Browser>
    })

    describe('Standard URL Formats', () => {
        it('should parse standard Zoom URL', async () => {
            const url = 'https://zoom.us/j/1234567890?pwd=abcdef'
            const result = await parseMeetingUrlFromJoinInfos(mockBrowser, url)
            expect(result).toEqual({
                meetingId: '1234567890',
                password: 'abcdef',
            })
        })

        it('should parse URL with dot in password', async () => {
            const url =
                'https://zoom.us/j/98519541483?pwd=mvnCGg66LoLUP3v4HrsOdjWIb2KQKH.1'
            const result = await parseMeetingUrlFromJoinInfos(mockBrowser, url)
            expect(result).toEqual({
                meetingId: '98519541483',
                password: 'mvnCGg66LoLUP3v4HrsOdjWIb2KQKH.1',
            })
        })

        it('should parse URL with Passcode format', async () => {
            const url =
                'https://us06web.zoom.us/j/88240852079 (Passcode: 584706)'
            const result = await parseMeetingUrlFromJoinInfos(mockBrowser, url)
            expect(result).toEqual({
                meetingId: '88240852079',
                password: '584706',
            })
        })

        it('should parse URL without spaces before Passcode', async () => {
            const url =
                'https://us06web.zoom.us/j/88240852079(Passcode: 584706)'
            const result = await parseMeetingUrlFromJoinInfos(mockBrowser, url)
            expect(result).toEqual({
                meetingId: '88240852079',
                password: '584706',
            })
        })
    })

    describe('Different Subdomains', () => {
        const subdomainTests = [
            {
                name: 'us02web subdomain',
                url: 'https://us02web.zoom.us/j/85001833920?pwd=cWY6TnhHRkdKZXcwSVk5aGE1VXpqUT09',
                expected: {
                    meetingId: '85001833920',
                    password: 'cWY6TnhHRkdKZXcwSVk5aGE1VXpqUT09',
                },
            },
            {
                name: 'us06web subdomain',
                url: 'https://us06web.zoom.us/j/84617432243?pwd=K30YMDo2VEwrSUNMSG16cZRzRWyjaE.1',
                expected: {
                    meetingId: '84617432243',
                    password: 'K30YMDo2VEwrSUNMSG16cZRzRWyjaE.1',
                },
            },
            {
                name: 'acrons-team subdomain',
                url: 'https://acrons-team.zoom.us/j/98832106351?pwd=LED1nQDsZvuIED3ccBTlw04Gzi0MOw.1',
                expected: {
                    meetingId: '98832106351',
                    password: 'LED1nQDsZvuIED3ccBTlw04Gzi0MOw.1',
                },
            },
        ]

        test.each(subdomainTests)(
            'should parse $name correctly',
            async ({ url, expected }) => {
                const result = await parseMeetingUrlFromJoinInfos(
                    mockBrowser,
                    url,
                )
                expect(result).toEqual(expected)
            },
        )
    })

    describe('URLs without Password', () => {
        const noPasswordTests = [
            {
                url: 'https://us02web.zoom.us/j/74495491647',
                meetingId: '74495491647',
            },
            {
                url: 'https://zoom.us/j/92648182477',
                meetingId: '92648182477',
            },
            {
                url: 'https://us05web.zoom.us/j/6298382741',
                meetingId: '6298382741',
            },
        ]

        test.each(noPasswordTests)(
            'should parse URL without password: $url',
            async ({ url, meetingId }) => {
                const result = await parseMeetingUrlFromJoinInfos(
                    mockBrowser,
                    url,
                )
                expect(result).toEqual({ meetingId, password: '' })
            },
        )
    })

    describe('Google Redirect URLs', () => {
        it('should handle Google redirect URL', async () => {
            const url =
                'https://www.google.com/url?q=https://zoom.us/j/1122334455?pwd=abc123'
            const result = await parseMeetingUrlFromJoinInfos(mockBrowser, url)
            expect(result).toEqual({
                meetingId: '1122334455',
                password: 'abc123',
            })
        })
    })

    describe('Error Cases', () => {
        it('should throw JoinError for invalid URL', async () => {
            await expect(
                parseMeetingUrlFromJoinInfos(
                    mockBrowser,
                    'https://invalid-url.com',
                ),
            ).rejects.toThrow(JoinError)
        })

        it('should throw JoinError for non-numeric meeting ID', async () => {
            await expect(
                parseMeetingUrlFromJoinInfos(
                    mockBrowser,
                    'https://zoom.us/j/abcdefg',
                ),
            ).rejects.toThrow(JoinError)
        })

        it('should throw JoinError for malformed URL', async () => {
            await expect(
                parseMeetingUrlFromJoinInfos(mockBrowser, 'not-a-url'),
            ).rejects.toThrow(JoinError)
        })
    })
    describe('Additional URL Formats', () => {
        describe('Web Client/PWA URLs', () => {
            const webClientTests = [
                {
                    name: 'basic web client URL',
                    url: 'https://app.zoom.us/wc/79642156509/',
                    expected: {
                        meetingId: '79642156509',
                        password: '',
                    },
                },
                {
                    name: 'PWA URL with password',
                    url: 'https://app.zoom.us/wc/79642156509/start?fromPWA=1&pwd=tJO3lY9HeH80y1mQw354RMsXzFilgW.1',
                    expected: {
                        meetingId: '79642156509',
                        password: 'tJO3lY9HeH80y1mQw354RMsXzFilgW.1',
                    },
                },
                {
                    name: 'PWA URL without password',
                    url: 'https://app.zoom.us/wc/98110585089/start?fromPWA=1',
                    expected: {
                        meetingId: '98110585089',
                        password: '',
                    },
                },
            ]

            test.each(webClientTests)(
                'should parse $name correctly',
                async ({ url, expected }) => {
                    const result = await parseMeetingUrlFromJoinInfos(
                        mockBrowser,
                        url,
                    )
                    expect(result).toEqual(expected)
                },
            )
        })

        describe('Personal Meeting Room URLs', () => {
            const pmrTests = [
                {
                    name: 'basic PMR URL',
                    url: 'https://zoom.us/my/voelker.ai',
                    expected: {
                        meetingId: 'voelker.ai',
                        password: '',
                    },
                },
                {
                    name: 'subdomain PMR URL',
                    url: 'https://turing.zoom.us/my/marco.santos.turing',
                    expected: {
                        meetingId: 'marco.santos.turing',
                        password: '',
                    },
                },
            ]

            test.each(pmrTests)(
                'should parse $name correctly',
                async ({ url, expected }) => {
                    const result = await parseMeetingUrlFromJoinInfos(
                        mockBrowser,
                        url,
                    )
                    expect(result).toEqual(expected)
                },
            )
        })

        describe('Special Password Formats', () => {
            it('should parse URL-encoded password params', async () => {
                const url =
                    'https://zoom.us/j/5165671036?pwd%3DaHkyUy9xcjBDczlDY3NOSCtXMlhMQT09&sa=D&source=calendar'
                const result = await parseMeetingUrlFromJoinInfos(
                    mockBrowser,
                    url,
                )
                expect(result).toEqual({
                    meetingId: '5165671036',
                    password: 'aHkyUy9xcjBDczlDY3NOSCtXMlhMQT09',
                })
            })

            it('should parse password appended without parentheses', async () => {
                const url =
                    'https://us06web.zoom.us/j/3290230144?pwd=esnQHAW0JYGE3jUbNQjkTjZmeNs6FQ.1Passcode: 497810'
                const result = await parseMeetingUrlFromJoinInfos(
                    mockBrowser,
                    url,
                )
                expect(result).toEqual({
                    meetingId: '3290230144',
                    password: '497810',
                })
            })
        })
    })
})
