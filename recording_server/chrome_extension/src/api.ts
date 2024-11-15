import axios from 'axios'
import * as rax from 'retry-axios'

export type MeetingProvider = 'Zoom' | 'Meet' | 'Teams'

type MessageType = 'SPEAKERS' | 'LOG' | 'UPLOAD_CHUNK'

// Yes, any is funny :cow:
type MessagePayload = any

export const sleep = (milliseconds: number) => {
    return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export type RecordingMode = 'speaker_view' | 'gallery_view' | 'audio_only'

export function setDefaultAxios() {
    // This file set the default config of axios
    axios.defaults.withCredentials = true

    axios.defaults.raxConfig = {
        instance: axios,
        retry: 5, // Number of retry attempts
        backoffType: 'exponential',
        noResponseRetries: 2, // Number of retries for no responses
        retryDelay: 1000, // Delay between each retry in milliseconds
        httpMethodsToRetry: ['GET', 'HEAD', 'OPTIONS', 'DELETE', 'PUT', 'POST'],
        statusCodesToRetry: [
            [100, 199],
            [400, 499],
            [500, 599],
        ],
        onRetryAttempt,
    }
    rax.attach()
    //Add a response interceptor wich is trigger by after all server response
}

function onRetryAttempt(err: any) {
    const cfg = rax.getConfig(err)
    const response = err.response && err.response.data ? err.response.data : err
    const request = err.request

    console.log(
        'Tentative de nouvelle essai #',
        cfg && cfg.currentRetryAttempt,
        {
            url: request.url,
            method: request.method,
            params: request.params,
            headers: request.headers,
            data: request.data,
            response: response,
        },
    )
}

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
            messageType,
            payload,
            url,
        )
        switch (messageType) {
            case 'UPLOAD_CHUNK':
                await axios
                    .post(`${url}transcoder/upload_chunk`, payload, {
                        headers: {
                            'Content-Type': 'application/octet-stream', // Or 'video/mp4' based on your video type
                        },
                        maxContentLength: 500 * 1024 * 1024, // 500MB limit to match server
                    })

                    .catch((error) => {
                        console.error(
                            'Failed to send upload chunk message:',
                            error,
                        )
                    })
                break
            case 'SPEAKERS':
                await axios
                    .post(`${url}add_speaker`, payload)
                    .catch((error) => {
                        console.error('Failed to send SPEAKER message:', error)
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
