import fs, { promises as fsPromises } from 'fs'
import winston from 'winston'
import { PathManager } from './PathManager'
import { s3cp } from './S3Uploader'

// Reference to current bot log file
let currentBotLogFile: string | null = null

// Store current caller info globally
let currentCaller = 'unknown:0'

let format = winston.format.combine(
    winston.format.colorize({
        all: true,
        colors: {
            info: 'cyan',
            warn: 'yellow',
            error: 'red',
            debug: 'blue',
        },
    }),
    winston.format.timestamp({
        format: () => new Date().toISOString(),
    }),
    winston.format.printf(({ timestamp, level, message }) => {
        return `${timestamp}  ${level} ${currentCaller}: ${message}`
    }),
)

function formatTable(data: any): string {
    if (!Array.isArray(data) && typeof data !== 'object') {
        return String(data)
    }

    const array = Array.isArray(data) ? data : [data]
    if (array.length === 0) return ''

    const headers = new Set<string>()
    array.forEach((item) =>
        Object.keys(item).forEach((key) => headers.add(key)),
    )
    const cols = Array.from(headers)

    const lines = [
        cols,
        cols.map(() => '-'.repeat(15)),
        ...array.map((item) =>
            cols.map((col) => String(item[col] ?? '').substring(0, 15)),
        ),
    ]

    const colWidths = cols.map((_, i) =>
        Math.max(...lines.map((line) => line[i].length)),
    )

    return (
        '\n' +
        lines
            .map(
                (line) =>
                    '│ ' +
                    line.map((val, i) => val.padEnd(colWidths[i])).join(' │ ') +
                    ' │',
            )
            .join('\n')
    )
}

function formatArgs(msg: string, args: any[]) {
    return (
        msg +
        ' ' +
        args
            .map((arg) => {
                if (arg === null) return 'null'
                if (arg === undefined) return 'undefined'
                if (typeof arg === 'object') {
                    try {
                        return JSON.stringify(arg, null, 2)
                    } catch (e) {
                        return String(arg)
                    }
                }
                return String(arg)
            })
            .join(' ')
    )
}

// Function to capture caller info at the console override level
function getCaller(): string {
    const stack = new Error().stack
    if (!stack) return 'unknown:0'

    const lines = stack.split('\n')
    // Look for the first non-internal frame (skip Error, getCaller, and console override)
    for (let i = 3; i < lines.length; i++) {
        const line = lines[i]
        if (
            line &&
            !line.includes('node_modules') &&
            !line.includes('Logger.ts')
        ) {
            const match =
                line.match(/at.*\((.+):(\d+):\d+\)/) ||
                line.match(/at (.+):(\d+):\d+/)
            if (match) {
                const fullPath = match[1]
                const filename =
                    fullPath.split('/').pop()?.split('.')[0] || 'unknown'
                const lineNumber = match[2]
                return `${filename}:${lineNumber}`
            }
        }
    }
    return 'unknown:0'
}

// Global winston logger
let logger = winston.createLogger({
    level: 'debug',
    format: format,
    transports: [
        new winston.transports.Console({
            format: format,
        }),
    ],
})

export function setupConsoleLogger() {
    console.log('Setting up console logger')

    console.log = (msg: string, ...args: any[]) => {
        currentCaller = getCaller()
        logger.info(formatArgs(msg, args))
    }
    console.info = (msg: string, ...args: any[]) => {
        currentCaller = getCaller()
        logger.info(formatArgs(msg, args))
    }
    console.warn = (msg: string, ...args: any[]) => {
        currentCaller = getCaller()
        logger.warn(formatArgs(msg, args))
    }
    console.error = (msg: string, ...args: any[]) => {
        currentCaller = getCaller()
        logger.error(formatArgs(msg, args))
    }
    console.debug = (msg: string, ...args: any[]) => {
        currentCaller = getCaller()
        logger.debug(formatArgs(msg, args))
    }
    console.table = (data: any) => {
        currentCaller = getCaller()
        logger.info(formatTable(data))
    }

    console.log('Console logger setup complete')
}

export async function uploadLogsToS3(options: {
    error?: Error
}): Promise<void> {
    try {
        let soundLogPath: string
        let s3SoundLogPath: string
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')

        const pathManager = PathManager.getInstance()
        const logPath = currentBotLogFile || pathManager.getIdentifier()
        soundLogPath = pathManager.getSoundLogPath()
        console.log('Looking for internal log files at:', {
            soundLogPath,
        })
        s3SoundLogPath = `${logPath}/sound.log`

        // Upload sound log file (internal log file)
        if (fs.existsSync(soundLogPath)) {
            logger.info(`Uploading sound logs to S3...`)
            await s3cp(soundLogPath, s3SoundLogPath, []) // TODO : s3_args !
            logger.info(`sound logs uploaded to S3`)
        } else {
            console.log('No sound log file found at path:', soundLogPath)
        }

        // TODO: Add other internal log files upload here as needed
    } catch (error) {
        logger.error(`Failed to upload logs to S3:`, error)
        throw error
    }
}

export function setupExitHandler() {
    process.on('uncaughtException', async (error) => {
        logger.error('Uncaught Exception: ' + error)
        try {
            await uploadLogsToS3({ error })
        } catch (uploadError) {
            logger.error('Failed to upload crash logs to S3: ' + uploadError)
        }
    })

    process.on('unhandledRejection', async (reason, promise) => {
        logger.error(
            'Unhandled Rejection at: ' + promise + ' reason: ' + reason,
        )
        try {
            await uploadLogsToS3({
                error:
                    reason instanceof Error
                        ? reason
                        : new Error(String(reason)),
            })
        } catch (uploadError) {
            logger.error('Failed to upload crash logs to S3: ' + uploadError)
        }
    })
}
