import axios from 'axios'
import { MeetingParams } from './types'

export class Events {
    private static EVENTS: Events | null = null

    static init(params: MeetingParams) {
        if (params.bot_uuid == null) return
        if (params.bots_api_key == null) return
        if (params.bots_webhook_url == null) return

        Events.EVENTS = new Events(
            params.bot_uuid,
            params.bots_api_key,
            params.bots_webhook_url,
        )
    }

    static joiningCall() {
        Events.EVENTS?.send('joining_call')
    }

    static inWaitingRoom() {
        Events.EVENTS?.send('in_waiting_room')
    }

    static inCallNotRecording() {
        Events.EVENTS?.send('in_call_not_recording')
    }

    static inCallRecording() {
        Events.EVENTS?.send('in_call_recording')
    }

    static callEnded() {
        Events.EVENTS?.send('call_ended')
    }

    private constructor(
        private botId: string,
        private apiKey: string,
        private webhookUrl: string,
    ) {}

    private send(code: string) {
        // Non-blocking axios call
        axios({
            method: 'POST',
            url: this.webhookUrl,
            timeout: 5000, // 5 secondes de timeout
            headers: {
                'User-Agent': 'meetingbaas/1.0',
                'x-meeting-baas-api-key': this.apiKey,
            },
            data: {
                event: 'bot.status_change',
                data: {
                    bot_id: this.botId,
                    status: {
                        code,
                        created_at: new Date().toISOString(),
                    },
                },
            },
        })
            .then(() => {
                console.log(
                    'Event sent successfully:',
                    code,
                    this.botId,
                    this.webhookUrl,
                )
            })
            .catch((error) => {
                console.error(
                    'Unable to send event:',
                    code,
                    this.botId,
                    this.webhookUrl,
                    error.message,
                )
            })
    }
}
