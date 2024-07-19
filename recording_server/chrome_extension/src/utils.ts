export const sleep = (milliseconds: number) => {
    return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export type LogType = 'LOG_INFO' | 'LOG_DEBUG' | 'STOP_MEETING'