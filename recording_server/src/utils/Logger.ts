import fs from 'fs'
import winston from 'winston'
import { PathManager } from './PathManager'
import { s3cp } from './S3Uploader'

// Variable pour garder une référence au fichier de log du bot
let currentBotLogFile: any = null

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

// Winston logger global
export let logger = winston.createLogger({
    level: 'debug',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) => {
            return `[${timestamp}] ${level.toUpperCase()} : ${message}`
        })
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize({
                    all: true,
                    colors: {
                        info: 'cyan',
                        warn: 'yellow',
                        error: 'red',
                        debug: 'blue',
                    }
                }),
                winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                winston.format.printf(({ timestamp, level, message }) => {
                    return `[${timestamp}] ${level} : ${message}`
                })
            )
        }),
        new winston.transports.File({ filename: './data/initial.log' })
    ]
})

export function setupConsoleLogger() {
    console.log = (msg: string, ...args: any[]) =>
        logger.info(formatArgs(msg, args))
    console.info = (msg: string, ...args: any[]) =>
        logger.info(formatArgs(msg, args))
    console.warn = (msg: string, ...args: any[]) =>
        logger.warn(formatArgs(msg, args))
    console.error = (msg: string, ...args: any[]) =>
        logger.error(formatArgs(msg, args))
    console.debug = (msg: string, ...args: any[]) =>
        logger.debug(formatArgs(msg, args))
    console.table = (data: any) => logger.info(formatTable(data))
}

export function redirectLogsToBot(botUuid: string) {
    const pathManager = PathManager.getInstance(botUuid)
    const logPath = pathManager.getLogPath()

    // Copier les logs initiaux vers le nouveau fichier
    fs.copyFileSync('./data/initial.log', logPath)
    fs.unlinkSync('./data/initial.log')

    // Remplacer le transport fichier par le nouveau fichier de log du bot
    logger.clear();
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize({
                all: true,
                colors: {
                    info: 'cyan',
                    warn: 'yellow',
                    error: 'red',
                    debug: 'blue',
                }
            }),
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.printf(({ timestamp, level, message }) => {
                return `[${timestamp}] ${level} : ${message}`
            })
        )
    }));
    logger.add(new winston.transports.File({ filename: logPath }));

    setupConsoleLogger()
    currentBotLogFile = logPath
}

export function setupExitHandler() {
    process.on('uncaughtException', async (error) => {
        logger.error('Uncaught Exception: ' + error);
        try {
            const pathManager = PathManager.getInstance();
            const logPath = pathManager.getLogPath();
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const s3LogPath = `crash-logs/${timestamp}-uncaught-exception.log`;
            if (fs.existsSync(logPath)) {
                logger.error('Uploading crash logs to S3...');
                await s3cp(logPath, s3LogPath);
                logger.error('Crash logs uploaded successfully to S3');
            } else {
                logger.error('No log file found to upload');
            }
        } catch (uploadError) {
            logger.error('Failed to upload crash logs to S3: ' + uploadError);
        }
    });

    process.on('unhandledRejection', async (reason, promise) => {
        logger.error('Unhandled Rejection at: ' + promise + ' reason: ' + reason);
        try {
            const pathManager = PathManager.getInstance();
            const logPath = pathManager.getLogPath();
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const s3LogPath = `crash-logs/${timestamp}-unhandled-rejection.log`;
            if (fs.existsSync(logPath)) {
                logger.error('Uploading crash logs to S3...');
                await s3cp(logPath, s3LogPath);
                logger.error('Crash logs uploaded successfully to S3');
            } else {
                logger.error('No log file found to upload');
            }
        } catch (uploadError) {
            logger.error('Failed to upload crash logs to S3: ' + uploadError);
        }
    });
}
