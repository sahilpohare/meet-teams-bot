import axios, { AxiosRequestConfig } from 'axios'
import * as rax from 'retry-axios'

export function addDefaultHeader(name: string, value: string) {
    axios.defaults.headers.common[name] = value
}

export async function axiosRetry(config: AxiosRequestConfig) {
    const myAxiosInstance = axios.create()
    const interceptorId = rax.attach(myAxiosInstance)
    let { raxConfig, ...axiosConfig } = config
    return await myAxiosInstance({
        ...axiosConfig,
        raxConfig: {
            retry: 5,

            noResponseRetries: 30,

            // Milliseconds to delay at first.  Defaults to 100. Only considered when backoffType is 'static' 
            retryDelay: 100,

            // HTTP methods to automatically retry.  Defaults to:
            // ['GET', 'HEAD', 'OPTIONS', 'DELETE', 'PUT']
            httpMethodsToRetry: ['POST', 'GET', 'HEAD', 'OPTIONS', 'DELETE', 'PUT'],

            // The response status codes to retry.  Supports a double
            // array with a list of ranges.  Defaults to:
            // [[100, 199], [429, 429], [500, 599]]
            statusCodesToRetry: [[100, 199], [429, 429], [500, 599]],

            // If you are using a non static instance of Axios you need
            // to pass that instance here (const ax = axios.create())
            instance: myAxiosInstance,
            backoffType: 'exponential',
            onRetryAttempt: err => {
                const cfg = rax.getConfig(err);
                const response = err.response?.data ? err.response.data : err
            },
            ...raxConfig
        }
    }
    )
}
