import { JoinError } from '../meeting'
import { parseMeetingUrlFromJoinInfos } from './teamsUrlParser'

describe('Teams URL Parser', () => {
    it('should parse valid Teams URL', () => {
        const validUrl =
            'https://teams.microsoft.com/l/meetup-join/19%3ameeting_OTNlNmVmZGItN2IzMC00MjQ4LThiNTAtZjBkMGI5NTFlNTA2%40thread.v2/0?context=%7b%22Tid%22%3a%2204c4b853-a523-4daa-b2cb-5ad547a87465%22%7d'

        expect(() => {
            parseMeetingUrlFromJoinInfos(validUrl)
        }).not.toThrow()
    })

    it('should reject invalid URL', () => {
        const invalidUrl = 'https://invalid-url.com/meeting'

        expect(() => {
            parseMeetingUrlFromJoinInfos(invalidUrl)
        }).toThrow(JoinError)
    })

    it('should reject non-Teams URL', () => {
        const nonTeamsUrl = 'https://microsoft.com/meeting'

        expect(() => {
            parseMeetingUrlFromJoinInfos(nonTeamsUrl)
        }).toThrow(JoinError)
    })

    it('should handle malformed URL', () => {
        const malformedUrl = 'not-a-url'

        expect(() => {
            parseMeetingUrlFromJoinInfos(malformedUrl)
        }).toThrow(JoinError)
    })
})
