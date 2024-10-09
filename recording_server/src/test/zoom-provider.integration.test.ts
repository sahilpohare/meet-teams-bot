import { JoinError } from '../meeting' // Ajustez le chemin si nécessaire
import { ZoomProvider } from '../meeting/zoom' // Assurez-vous que le chemin est correct
import { ZoomProviderMock } from './zoom-provider-mock'

describe('ZoomProvider URL Parsing Tests', () => {
    let zoomProvider: ZoomProvider

    beforeEach(() => {
        zoomProvider = new ZoomProviderMock()
    })

    const testCases = [
        {
            name: 'Standard Zoom URL',
            url: 'https://zoom.us/j/1234567890?pwd=abcdef',
            expected: { meetingId: '1234567890', password: 'abcdef' },
        },
        {
            name: 'url with dot in password',
            url: 'https://zoom.us/j/98519541483?pwd=mvnCGg66LoLUP3v4HrsOdjWIb2KQKH.1',
            expected: {
                meetingId: '98519541483',
                password: 'mvnCGg66LoLUP3v4HrsOdjWIb2KQKH.1',
            },
        },
        {
            name: 'url with dot in password 2',
            url: 'https://zoom.us/j/96889925999?pwd=nv8HB4Mcekz7dufbTFTHrRdMgeDm4F.1',
            expected: {
                meetingId: '96889925999',
                password: 'nv8HB4Mcekz7dufbTFTHrRdMgeDm4F.1',
            },
        },
        {
            name: 'url with dot in password 3',
            url: 'https://zoom.us/j/98272752193?pwd=ucsX9oV2AuEaT3xhYm87PAmTjlRaKS.1',
            expected: {
                meetingId: '98272752193',
                password: 'ucsX9oV2AuEaT3xhYm87PAmTjlRaKS.1',
            },
        },
        {
            name: 'url with dot in password 4',
            url: 'https://us04web.zoom.us/j/78272441146?pwd=buD2J6X5SlOx6s1JovK0bA3jkpc0yT.1',
            expected: {
                meetingId: '78272441146',
                password: 'buD2J6X5SlOx6s1JovK0bA3jkpc0yT.1',
            },
        },
        {
            name: 'other url type',
            url: 'https://us06web.zoom.us/j/88240852079 (Passcode: 584706)',
            expected: {
                meetingId: '88240852079',
                password: '584706',
            },
        },
        {
            name: 'other url type',
            url: 'https://us06web.zoom.us/j/88240852079(Passcode: 584706)',
            expected: {
                meetingId: '88240852079',
                password: '584706',
            },
        },
        {
            name: 'URL with j and pwd parameters',
            url: 'https://us02web.zoom.us/j/85001833920?pwd=cWY6TnhHRkdKZXcwSVk5aGE1VXpqUT09',
            expected: {
                meetingId: '85001833920',
                password: 'cWY6TnhHRkdKZXcwSVk5aGE1VXpqUT09',
            },
        },
        {
            name: 'URL with j and pwd parameters 2',
            url: 'https://us06web.zoom.us/j/84617432243?pwd=K30YMDo2VEwrSUNMSG16cZRzRWyjaE.1',
            expected: {
                meetingId: '84617432243',
                password: 'K30YMDo2VEwrSUNMSG16cZRzRWyjaE.1',
            },
        },
        {
            name: 'URL with j parameter only',
            url: 'https://us02web.zoom.us/j/74495491647',
            expected: {
                meetingId: '74495491647',
                password: undefined,
            },
        },
        {
            name: 'Simple URL with j parameter',
            url: 'https://zoom.us/j/92648182477',
            expected: {
                meetingId: '92648182477',
                password: undefined,
            },
        },
        {
            name: 'URL with j and pwd parameters 3',
            url: 'https://us06web.zoom.us/j/88401743244?pwd=K30YMDo2VEwrSUNMSG16cZRzRWyjaE.1',
            expected: {
                meetingId: '88401743244',
                password: 'K30YMDo2VEwrSUNMSG16cZRzRWyjaE.1',
            },
        },
        {
            name: 'URL with j and pwd parameters 4',
            url: 'https://us06web.zoom.us/j/85612106629?pwd=4NqZLBQbFSuy59WzSToxKSzWHVLkN.1',
            expected: {
                meetingId: '85612106629',
                password: '4NqZLBQbFSuy59WzSToxKSzWHVLkN.1',
            },
        },
        {
            name: 'URL with j and pwd parameters 5',
            url: 'https://us06web.zoom.us/j/81308321979?pwd=TWZyZXNOamdPbVcwU2JEaXNBWHo4QT09',
            expected: {
                meetingId: '81308321979',
                password: 'TWZyZXNOamdPbVcwU2JEaXNBWHo4QT09',
            },
        },
        {
            name: 'URL with j parameter only 2',
            url: 'https://us05web.zoom.us/j/6298382741',
            expected: {
                meetingId: '6298382741',
                password: undefined,
            },
        },
        // New test cases based on the image
        {
            name: 'Acrons team URL with pwd parameter',
            url: 'https://acrons-team.zoom.us/j/98832106351?pwd=LED1nQDsZvuIED3ccBTlw04Gzi0MOw.1',
            expected: {
                meetingId: '98832106351',
                password: 'LED1nQDsZvuIED3ccBTlw04Gzi0MOw.1',
            },
        },
        {
            name: 'US02 web zoom URL with pwd parameter',
            url: 'https://us02web.zoom.us/j/82738253390?pwd=IP4LWC6uRapQJuIMxA5ga2NjQakN.1',
            expected: {
                meetingId: '82738253390',
                password: 'IP4LWC6uRapQJuIMxA5ga2NjQakN.1',
            },
        },
        {
            name: 'US01 web zoom URL with pwd parameter',
            url: 'https://us01web.zoom.us/j/83185344137?pwd=PLGCD3aMR0ZEDfcNULgLzySoPS3D0',
            expected: {
                meetingId: '83185344137',
                password: 'PLGCD3aMR0ZEDfcNULgLzySoPS3D0',
            },
        },

        {
            name: 'Zoom URL with subdomain',
            url: 'https://us02web.zoom.us/j/87654321?pwd=xyz123',
            expected: { meetingId: '87654321', password: 'xyz123' },
        },
        {
            name: 'Zoom URL without password',
            url: 'https://company.zoom.us/j/9876543210',
            expected: { meetingId: '9876543210', password: undefined },
        },
        {
            name: 'Google redirect URL',
            url: 'https://www.google.com/url?q=https://zoom.us/j/1122334455?pwd=abc123',
            expected: { meetingId: '1122334455', password: 'abc123' },
        },
        {
            name: 'URL with password in different format',
            url: 'https://zoom.us/j/1234567890 (Password: 123456)',
            expected: { meetingId: '1234567890', password: '123456' },
        },
        // Ajoutez d'autres cas de test ici
    ]

    test.each(testCases)(
        'should correctly parse $name',
        async ({ url, expected }) => {
            const result = await zoomProvider.parseMeetingUrl(null, url)
            expect(result).toEqual(expected)
        },
    )

    test('should throw JoinError for invalid URL', async () => {
        await expect(
            zoomProvider.parseMeetingUrl(null, 'https://invalid-url.com'),
        ).rejects.toThrow(JoinError)
    })

    test('should throw JoinError for non-numeric meeting ID', async () => {
        await expect(
            zoomProvider.parseMeetingUrl(null, 'https://zoom.us/j/abcdefg'),
        ).rejects.toThrow(JoinError)
    })
})
