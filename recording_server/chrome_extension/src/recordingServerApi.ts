// RecordingServerApi.ts

import axios from 'axios'

type MessageType =
    | 'REFRESH_ATTENDEES'
    | 'REFRESH_SPEAKERS'
    | 'LOG'
    | 'LOG_SPEAKER'
    | 'OBSERVE_SPEAKERS'
    | 'RECORD'
    | 'STOP'
    | 'STOP_MEETING'

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
            case 'LOG_SPEAKER':
                await axios
                    .post(`${url}observe_speaker`, payload)
                    .catch((error) => {
                        console.error(
                            'Failed to send LOG_SPEAKER message:',
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
