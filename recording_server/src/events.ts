import axios from 'axios'
import { MeetingParams } from './types'

export class Events {
    private static EVENTS: Events | null = null

    private log(...args: any[]): void {
        console.log(`[${this.constructor.name}]`, ...args)
    }
    private error(...args: any[]): void {
        console.error(`[${this.constructor.name}]`, ...args)
    }

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

    static async joiningCall() {
        await Events.EVENTS?.send('joining_call')
    }

    static async inWaitingRoom() {
        await Events.EVENTS?.send('in_waiting_room')
    }

    static async inCallNotRecording() {
        await Events.EVENTS?.send('in_call_not_recording')
    }

    static async inCallRecording() {
        await Events.EVENTS?.send('in_call_recording')
    }

    static async callEnded() {
        await Events.EVENTS?.send('call_ended')
    }

    private constructor(
        private botId: string,
        private apiKey: string,
        private webhookUrl: string,
    ) {}

    private async send(code: string) {
        axios({
            method: 'POST',
            url: this.webhookUrl,
            headers: {
                'x-spoke-api-key': this.apiKey,
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
            this.log('Event sended', code, this.botId, this.webhookUrl)
        })
        .catch((_e) => {
            this.error(
                'Unable to send event',
                code,
                this.botId,
                this.webhookUrl,
                // e,
            )
        })
    }
}
