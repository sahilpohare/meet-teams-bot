import { Channel, connect } from 'amqplib'
import {
    LOCK_INSTANCE_AT_STARTUP,
    POD_IP,
    setProtection,
    setSessionInRedis,
} from './instance'

import { Events } from './events'
import { updateGrafanaAgentAddBotUuid } from './logger'
import { MeetingHandle } from './meeting'
import { MeetingParams } from './types'
import { Streaming } from './streaming'

const POD_NAME = process.env.POD_NAME

export type StartRecordingResult = {
    params: MeetingParams
    error: any | null
}

export class Consumer {
    static readonly QUEUE_NAME = LOCK_INSTANCE_AT_STARTUP
        ? POD_NAME
        : 'worker_bot_queue'
    static readonly PREFETCH_COUNT = 1

    private constructor(private channel: Channel) {}

    static async init(): Promise<Consumer> {
        const connection = await connect(process.env.AMQP_ADDRESS)

        console.log('connected to rabbitmq: ', process.env.AMQP_ADDRESS)
        const channel = await connection.createChannel()

        console.log('declaring queue: ', Consumer.QUEUE_NAME)
        channel.prefetch(Consumer.PREFETCH_COUNT)

        return new Consumer(channel)
    }

    async deleteQueue() {
        if (LOCK_INSTANCE_AT_STARTUP && Consumer.QUEUE_NAME === POD_NAME) {
            try {
                await this.channel.deleteQueue(Consumer.QUEUE_NAME)
            } catch (e) {
                console.error('fail to delete queue', e)
            }
        }
    }

    async consume(
        handler: (data: MeetingParams) => Promise<void>,
    ): Promise<StartRecordingResult> {
        return new Promise((resolve, reject) => {
            this.channel
                .consume(Consumer.QUEUE_NAME, async (message) => {
                    if (message !== null) {
                        // configure rabbit increase timeout or timeout max < rabbitmq message timeout
                        await this.channel.cancel(message.fields.consumerTag)

                        const meetingParams = JSON.parse(
                            message.content.toString(),
                        )
                        let error = null
                        try {
                            await handler(meetingParams)
                        } catch (e) {
                            error = e
                        }
                        // TODO: retry in rabbitmq
                        this.channel.ack(message)
                        resolve({ params: meetingParams, error: error })
                    } else {
                        console.log('Consumer cancelled by server')
                        reject() // TODO errors
                    }
                })
                .then((consumer) => {
                    console.log('consumer started: ', consumer.consumerTag)
                })
                .catch((e) => {
                    reject() // TODO errors
                })
        })
    }

    // throw error if start recoridng fail
    static async handleStartRecord(data: MeetingParams) {
        if (data.streaming_input || data.streaming_output) {
            new Streaming(
                data.streaming_input,
                data.streaming_output,
                data.bot_id,
            )
        }
        await updateGrafanaAgentAddBotUuid(data.bot_id)

        console.log('####### DATA #######', data)
        // Prevent instance for beeing scaled down
        try {
            await setProtection(true)
        } catch (e) {
            console.error('fail to set protection', e)
        }
        let meetingSession = {
            bot_ip: POD_IP,
            user_id: data.user_id,
            meeting_url: data.meeting_url,
        }
        try {
            await setSessionInRedis(data.session_id, meetingSession)
        } catch (e) {
            console.error('fail to set session in redis: ', e)
        }
        MeetingHandle.init(data)

        Events.init(data)
        await Events.joiningCall()

        await MeetingHandle.instance.startRecordMeeting()
    }
}
