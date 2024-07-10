export const sleep = (milliseconds: number) => {
    return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export type LogType = 'LOG_INFO' | 'LOG_DEBUG' | 'STOP_MEETING'

function logServer(message: string, messageType: LogType) {
    chrome.runtime.sendMessage({
        type: 'SEND_TO_SERVER',
        payload: {
            messageType: messageType,
            data: { reason: message },
        },
    })
}

export function logger(message: any, messageType: LogType) {
    const FAKE_ENV = 'LOCAL'
    if (messageType == 'LOG_DEBUG') {
        if (FAKE_ENV === 'LOCAL') {
            logServer(message, messageType)
        }
    } else {
        logServer(message, messageType)
    }
}
