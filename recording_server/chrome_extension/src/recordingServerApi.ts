// RecordingServerApi.ts

import axios from 'axios'

type MessageType = 'SPEAKERS' | 'LOG' | 'STOP_MEETING' | 'START_TRANSCODER' | 'UPLOAD_CHUNK' | 'STOP_TRANSCODER' | 'EXTRACT_AUDIO'

// Yes, any is funny :cow:
type MessagePayload = any

export class ApiService {
    private static RecordingServerLocation: string | null = null

    private constructor() {}

    public static async init(url: string): Promise<void> {
        return new Promise((resolve) => {
            chrome.storage.local.set({ RecordingServerLocation: url }, () => {
                ApiService.RecordingServerLocation = url
                console.log('ApiService initialized with URL:', url)
                resolve()
            })
        })
    }

    public static async getRecordingServerLocation(): Promise<string | null> {
        if (ApiService.RecordingServerLocation) {
            return ApiService.RecordingServerLocation
        }

        return new Promise((resolve) => {
            chrome.storage.local.get(['RecordingServerLocation'], (result) => {
                ApiService.RecordingServerLocation =
                    result.RecordingServerLocation || null
                resolve(ApiService.RecordingServerLocation)
            })
        })
    }

    public static async sendMessageToRecordingServer(
        messageType: MessageType,
        payload: MessagePayload,
    ): Promise<void> {
        const url = await ApiService.getRecordingServerLocation()
        if (!url) {
            throw new Error('ApiService not initialized. Call init() first.')
        }

        console.log(
            'Sending message to recording server with PATH:',
            payload,
            url,
        )
        switch (messageType) {
            case 'START_TRANSCODER':
                await axios
                    .post(`${url}transcoder/start`, payload)
                    .catch((error) => {
                        console.error(
                            'Failed to send transcoder start message:',
                            error,
                        )
                    })
                break
            case 'UPLOAD_CHUNK':
                await axios
                    .post(`${url}transcoder/upload_chunk`, payload)
                    .catch((error) => {
                        console.error(
                            'Failed to send upload chunk message:',
                            error,
                        )
                    })
                break
            case 'EXTRACT_AUDIO':
                await axios
                    .post(`${url}transcoder/extract_audio`, payload)
                    .catch((error) => {
                        console.error(
                            'Failed to send extract_audio message:',
                            error,
                        )
                    })
                break
            case 'STOP_TRANSCODER':
                await axios
                    .post(`${url}transcoder/stop`, payload)
                    .catch((error) => {
                        console.error(
                            'Failed to send stop transcoder message:',
                            error,
                        )
                    })
                break
            case 'SPEAKERS':
                await axios
                    .post(`${url}add_speaker`, payload)
                    .catch((error) => {
                        console.error(
                            'Failed to send SPEAKER message:',
                            error,
                        )
                    })
                break
            case 'STOP_MEETING':
                await axios
                    .post(`${url}stop_meeting`, payload)
                    .catch((error) => {
                        console.error(
                            'Failed to send STOP_MEETING message:',
                            error,
                        )
                    })
                break
            case 'LOG':
                await axios
                    .post(`${url}broadcast_message`, payload)
                    .catch((error) => {
                        console.error('Failed to send LOG message:', error)
                    })
                break
            default:
                console.error('Unexpected message type !')
        }
    }
}
