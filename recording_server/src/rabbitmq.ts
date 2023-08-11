import { connect, Channel } from 'amqplib';
import { MeetingParams, startRecordMeeting, setInitalParams } from './meeting'
import { LOGGER } from "./server";
import { setProtection } from './instance'
import { sleep } from './utils'
import { notifyApp, patchEvent } from './calendar'

//
// TODO HANDLE ERRORS
//

export class Consumer {
    static readonly QUEUE_NAME = "worker_bot_queue";
    static readonly PREFETCH_COUNT = 1;

    private constructor(private channel: Channel) {}

    static async init(): Promise<Consumer> {
        const connection = await connect(process.env.AMQP_ADDRESS);

        const channel = await connection.createChannel();
        await channel.assertQueue(Consumer.QUEUE_NAME, { durable: true });
        channel.prefetch(Consumer.PREFETCH_COUNT);

        return new Consumer(channel);
    }

    async consume(handler): Promise<MeetingParams> {
        return new Promise((resolve, reject) => {
            this.channel.consume(Consumer.QUEUE_NAME, async (message) => {
              if (message !== null) {
                  await this.channel.cancel(message.fields.consumerTag);

                  const meetingParams = JSON.parse(message.content);
                  await handler(meetingParams);
                  this.channel.ack(message);
                  resolve(meetingParams);
              } else {
                  console.log('Consumer cancelled by server');
                  reject(); // TODO errors
              }
            });
        });
    }

    static async handleStartRecord(data: MeetingParams) {
        // Prevent instance for beeing scaled down
        await setProtection(true)

        let logger = LOGGER.new({
            user_id: data.user_id,
            meeting_url: data.meeting_url,
        })

        try {
            logger.info(`Start record`, {
                human_transcription: data.human_transcription,
                use_my_vocabulary: data.use_my_vocabulary,
                language: data.language,
                project_name: data.project_name,
                email: data.email,
            })

            setInitalParams(data, logger)

            try {
                const project = await startRecordMeeting(data);

                if (data.event != null) {
                    try {
                        await patchEvent(data.user_token, {
                            status: 'Recording',
                            session_id: data.api_session_id,
                id: data.event?.id,
                            project_id: project.id,
                        })
                    } catch (e) {
                        logger.error(`error patching event`, e)
                    }
                }
            } catch (e) {
                if (data.event != null) {
                    try {
                        await notifyApp(
                            'Error',
                            data,
                            { error: JSON.stringify(e) },
                            { error: JSON.stringify(e) },
                        )
                    } catch (e) {
                        logger.error(`error in start_record_event catch handler, terminating instance`, e)
                    }
                }
            }
        } catch (e) {
            logger.error(`Unknown error`, e)
        }
    }
}
