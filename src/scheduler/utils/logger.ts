/**
 * Logger utility for scheduler module
 * Simple wrapper around console for logging
 */

export const logger = {
    info: (message: string, ...args: any[]) => {
        console.log(`[INFO] ${message}`, ...args)
    },
    warn: (message: string, ...args: any[]) => {
        console.warn(`[WARN] ${message}`, ...args)
    },
    error: (message: string, ...args: any[]) => {
        console.error(`[ERROR] ${message}`, ...args)
    },
    debug: (message: string, ...args: any[]) => {
        if (process.env.DEBUG_LOGS === 'true') {
            console.log(`[DEBUG] ${message}`, ...args)
        }
    },
}
