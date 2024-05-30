import { Channel, connect } from 'amqplib'
import axios from 'axios'
import { notify, notifyApp } from './calendar'
import { Events } from './events'
import {
    LOCK_INSTANCE_AT_STARTUP,
    POD_IP,
    setProtection,
    setSessionInRedis,
} from './instance'
import { setLoggerProjectId } from './logger'
import { MeetingHandle } from './meeting'
import { LOGGER } from './server'
import { MeetingParams } from './types'

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

                        axios.defaults.headers.common['Authorization'] =
                            meetingParams.user_token
                        // Ping /meeting_bot/received_message to record waiting time stats
                        try {
                            const url = `/meeting_bot/received_message?session_id=${meetingParams.session_id}`
                            console.log(`POST ${url}`)
                            await axios({
                                method: 'POST',
                                url,
                            })
                        } catch (e) {
                            console.error(
                                'POST /meeting_bot/received_message FAILED',
                                e,
                            )
                        }

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
        let logger = LOGGER.new({})

        // Prevent instance for beeing scaled down
        // TODO: pk c'est pas try
        await setProtection(true)
        if (LOCK_INSTANCE_AT_STARTUP) {
            try {
                await notifyApp('PrepareRecording', data, {}, {})
            } catch (e) {
                logger.error(`fail to nitfy app`, e)
            }
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
        MeetingHandle.init(data, logger)

        Events.init(data)
        await Events.joiningCall()

        const project = await MeetingHandle.instance.startRecordMeeting()
        setLoggerProjectId(project?.id)
        try {
            await notify({
                message: 'BotEntered',
                user_id: data.user_id,
                payload: {
                    agenda: data.agenda,
                    session_id: data.session_id,
                    meeting_url: data.meeting_url,
                    project,
                },
            })
        } catch (e) {
            logger.error(`fail to nitfy app`, e)
        }
        try {
            await notifyApp(
                'Recording',
                data,
                {
                    session_id: data.session_id,
                    project_id: project.id,
                },
                {
                    session_id: data.session_id,
                    project,
                },
            )
        } catch (e) {
            logger.error(`fail to nitfy app`, e)
        }
    }
}
