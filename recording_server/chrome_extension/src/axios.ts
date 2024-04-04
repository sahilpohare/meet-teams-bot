import axios from 'axios'
import * as rax from 'retry-axios'

export let API_BOT_BASEURL: string = ''

type SpokeApiConfig = {
    authorizationToken?: string
    api_server_internal_url?: string
    api_bot_internal_url?: string
    defaultUrl?: string
    logError: any
}

export function setConfig(config: SpokeApiConfig) {
    if (config.authorizationToken) {
        setDefaultHeader('Authorization', config.authorizationToken)
    }
    if (config.defaultUrl) {
        API_BOT_BASEURL = config.defaultUrl
        setDefaultAxios(config.defaultUrl, config.logError)
    }
    if (config.api_server_internal_url) {
        setDefaultAxios(config.api_server_internal_url, config.logError)
    }
    if (config.api_bot_internal_url) {
        API_BOT_BASEURL = config.api_bot_internal_url
    }
}

export function setDefaultHeader(name: string, value: string) {
    axios.defaults.headers.common[name] = value
}

export function setDefaultAxios(baseUrl: string, logError: any) {
    axios.defaults.baseURL = baseUrl
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
    console.log(
        `Retry attempt #${cfg && cfg.currentRetryAttempt}`,
        err.request,
        response,
    )
}
