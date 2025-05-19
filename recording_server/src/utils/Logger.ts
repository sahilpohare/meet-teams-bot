import fs, { promises as fsPromises } from 'fs'
import os from 'os'
import path from 'path'
import winston from 'winston'
import { PathManager } from './PathManager'
import { s3cp } from './S3Uploader'

// Variable pour garder une référence au fichier de log du bot
let currentBotLogFile: any = null
let format = winston.format.combine(
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
    format: format,
    transports: [
        new winston.transports.Console({
            format: format
        }),
        new winston.transports.File({ filename: './data/initial.log', format: format })
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


export async function redirectLogsToBot(botUuid: string) {
    const pathManager = PathManager.getInstance(botUuid)
    const logPath = pathManager.getLogPath()
    
    // Copier les logs initiaux vers le nouveau fichier
    const homeDir = os.homedir()
    const logsPath = path.join(homeDir, 'logs.txt')
    
    await fsPromises.copyFile(logsPath, logPath).catch(err => {
        console.error('Failed to copy logs.txt to logPath:', err)
    })

    fs.appendFileSync('./data/initial.log', logPath)
    fs.unlinkSync('./data/initial.log')

    // Remplacer le transport fichier par le nouveau fichier de log du bot
    logger.clear();
    logger.add(new winston.transports.Console({
        format: format
    }));
    logger.add(new winston.transports.File({ filename: logPath, format: format }));

    setupConsoleLogger()
    currentBotLogFile = logPath
}

export async function uploadLogsToS3(options: {
    bot_uuid?: string;
    secret?: string;
    type: 'normal' | 'crash' | 'force-termination';
    error?: Error;
}): Promise<void> {
    try {
        let pathManager: PathManager;
        let logPath: string;
        let s3LogPath: string;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        switch (options.type) {
            case 'normal':
            case 'force-termination':
                if (!options.bot_uuid || !options.secret) {
                    throw new Error('bot_uuid and secret are required for normal log upload');
                }
                pathManager = PathManager.getInstance(options.bot_uuid, options.secret);
                logPath = pathManager.getLogPath();
                s3LogPath = `${options.bot_uuid}/logs.log`;
                break;
            case 'crash':
                pathManager = PathManager.getInstance();  // Sans paramètres pour les crashs
                logPath = pathManager.getLogPath();
                s3LogPath = `crash-logs/${timestamp}-${options.error?.name || 'unknown'}.log`;
                break;
        }
        
        if (!fs.existsSync(logPath)) {
            logger.error('No log file found to upload');
            return;
        }

        logger.info(`Uploading ${options.type} logs to S3...`);
        await s3cp(logPath, s3LogPath);
        logger.info(`${options.type} logs uploaded successfully to S3`);
    } catch (error) {
        logger.error(`Failed to upload ${options.type} logs to S3:`, error);
        throw error; // Re-throw to let caller handle it
    }
}

export function setupExitHandler() {
    process.on('uncaughtException', async (error) => {
        logger.error('Uncaught Exception: ' + error);
        try {
            await uploadLogsToS3({
                type: 'crash',
                error
            });
        } catch (uploadError) {
            logger.error('Failed to upload crash logs to S3: ' + uploadError);
        }
    });

    process.on('unhandledRejection', async (reason, promise) => {
        logger.error('Unhandled Rejection at: ' + promise + ' reason: ' + reason);
        try {
            await uploadLogsToS3({
                type: 'crash',
                error: reason instanceof Error ? reason : new Error(String(reason))
            });
        } catch (uploadError) {
            logger.error('Failed to upload crash logs to S3: ' + uploadError);
        }
    });
}
