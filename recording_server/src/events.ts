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

    static async apiRequestStop() {
        return Events.EVENTS?.send('api_request_stop')
    }

    static async joiningCall() {
        return Events.EVENTS?.send('joining_call')
    }

    static async inWaitingRoom() {
        return Events.EVENTS?.send('in_waiting_room')
    }

    static async inCallNotRecording() {
        return Events.EVENTS?.send('in_call_not_recording')
    }

    static async inCallRecording(data: { start_time: number }) {
        return Events.EVENTS?.send('in_call_recording', data)
    }

    static async recordingPaused() {
        return Events.EVENTS?.send('recording_paused')
    }

    static async recordingResumed() {
        return Events.EVENTS?.send('recording_resumed')
    }

    static async callEnded() {
        return Events.EVENTS?.send('call_ended')
    }

    // Nouveaux événements pour les erreurs
    static async botRejected() {
        return Events.EVENTS?.send('bot_rejected')
    }

    static async botRemoved() {
        return Events.EVENTS?.send('bot_removed')
    }

    static async waitingRoomTimeout() {
        return Events.EVENTS?.send('waiting_room_timeout')
    }

    static async invalidMeetingUrl() {
        return Events.EVENTS?.send('invalid_meeting_url')
    }

    static async meetingError(error: Error) {
        return Events.EVENTS?.send('meeting_error', {
            error_message: error.message,
            error_type: error.constructor.name,
        })
    }

    private constructor(
        private botId: string,
        private apiKey: string,
        private webhookUrl: string,
    ) {}

    private async send(
        code: string,
        additionalData: Record<string, any> = {},
    ): Promise<void> {
        try {
            await axios({
                method: 'POST',
                url: this.webhookUrl,
                timeout: 5000,
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
                            ...additionalData,
                        },
                    },
                },
            })
            console.log(
                'Event sent successfully:',
                code,
                this.botId,
                this.webhookUrl,
            )
        } catch (error) {
            if (error instanceof Error) {
                console.warn(
                    'Unable to send event (continuing execution):',
                    code,
                    this.botId,
                    this.webhookUrl,
                    error.message,
                )
            }
        }
    }
}
