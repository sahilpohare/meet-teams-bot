import axios from 'axios'
import * as rax from 'retry-axios'

import { ApiTypes } from './types'

import { MeetingParams } from '../types'
import { Console } from '../utils'
import { RecognizerWord } from '../words_poster/words_poster'

export class Api {
    public static instance: Api | null = null // Singleton class

    private bot_uuid: string

    constructor(params: MeetingParams) {
        if (Api.instance instanceof Api) {
            console.error(
                'Class is singleton, constructor cannot be called multiple times.',
            )
            return Api.instance
        }
        axios.defaults.headers.common['Authorization'] = params.user_token
        axios.defaults.baseURL = process.env.API_SERVER_BASEURL
        axios.defaults.withCredentials = true

        axios.defaults.raxConfig = {
            instance: axios,
            retry: 5, // Number of retry attempts
            backoffType: 'exponential',
            noResponseRetries: 2, // Number of retries for no responses
            retryDelay: 1000, // Delay between each retry in milliseconds
            httpMethodsToRetry: [
                'GET',
                'HEAD',
                'OPTIONS',
                'DELETE',
                'PUT',
                'POST',
            ],
            statusCodesToRetry: [
                [100, 199],
                [400, 499],
                [500, 599],
            ],
            onRetryAttempt: this.onRetryAttempt,
        }
        rax.attach()
        this.bot_uuid = params.bot_uuid
        Api.instance = this
    }

    private onRetryAttempt(err: any) {
        const cfg = rax.getConfig(err)
        const response =
            err.response && err.response.data ? err.response.data : err
        const request = err.request

        console.log(
            'Attempt of a new trial #',
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

    // Finalize bot structure into BDD and send webhook
    public async endMeetingTrampoline() {
        const resp = await axios({
            method: 'POST',
            url: '/bots/end_meeting_trampoline',
            params: {
                bot_uuid: this.bot_uuid,
            },
            data: {
                diarization_v2: false,
            },
        })
        return resp.data
    }

    // Simply get Bot structure
    public async getBot(): Promise<ApiTypes.GetableBot> {
        return (
            await axios({
                method: 'GET',
                url: `/bots/${this.bot_uuid}`,
            })
        ).data
    }

    // Post transcript to server
    public async postTranscript(
        transcript: ApiTypes.PostableTranscript,
    ): Promise<ApiTypes.QueryableTranscript> {
        return (
            await axios({
                method: 'POST',
                url: `/bots/transcripts`,
                data: transcript,
            })
        ).data
    }

    // Patch existing transcript
    public async patchTranscript(
        transcript: ApiTypes.ChangeableTranscript,
    ): Promise<ApiTypes.QueryableTranscript> {
        return (
            await axios({
                method: 'PATCH',
                url: `/bots/transcripts`,
                data: transcript,
            })
        ).data
    }

    // Post words into server
    public async postWords(
        words: RecognizerWord[],
        bot_id: number,
    ): Promise<ApiTypes.Word[]> {
        return (
            await axios({
                method: 'POST',
                url: `/bots/transcripts/${bot_id}/words`,
                data: words,
            })
        ).data
    }
}
