import { connect, Channel } from 'amqplib'
import { MeetingParams, startRecordMeeting, setInitalParams } from './meeting'
import { LOGGER } from './server'
import { LOCK_INSTANCE_AT_STARTUP, setProtection } from './instance'
import { notify, notifyApp, patchEvent } from './calendar'
import { setLoggerProjectId } from './logger'

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

        const channel = await connection.createChannel()
        await channel.assertQueue(Consumer.QUEUE_NAME, { durable: true })
        channel.prefetch(Consumer.PREFETCH_COUNT)

        return new Consumer(channel)
    }

    async consume(handler): Promise<StartRecordingResult> {
        return new Promise((resolve, reject) => {
            this.channel.consume(Consumer.QUEUE_NAME, async (message) => {
                if (message !== null) {
                    await this.channel.cancel(message.fields.consumerTag)

                    const meetingParams = JSON.parse(message.content)
                    let error = null
                    try {
                        await handler(meetingParams)
                    } catch (e) {
                        error = e
                    }
                    //TODO: retry in rabbitmq
                    this.channel.ack(message)
                    resolve({ params: meetingParams, error: error })
                } else {
                    console.log('Consumer cancelled by server')
                    reject() // TODO errors
                }
            })
        })
    }

    // throw error if start recoridng fail
    static async handleStartRecord(data: MeetingParams) {
        // Prevent instance for beeing scaled down

        let logger = LOGGER.new({
            user_id: data.user_id,
            meeting_url: data.meeting_url,
        })

        await setProtection(true)
        if (LOCK_INSTANCE_AT_STARTUP) {
            try {
                await notifyApp('PrepareRecording', data, {}, {})
            } catch (e) {
                logger.error(`fail to nitfy app`, e)
            }
        }

        setInitalParams(data, logger)

        const project = await startRecordMeeting(data)
        setLoggerProjectId(project?.id)
        try {
            await notify(data.user_token, {
                message: 'BotEntered',
                user_id: data.user_id,
                payload: {
                    session: data.session_id,
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
