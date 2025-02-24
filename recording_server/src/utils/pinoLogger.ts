import { join } from 'path';
import pino from 'pino';
import caller from 'pino-caller';
import { PathManager } from './PathManager';

// Variable pour garder une référence au fichier de log du bot
let currentBotLogFile: any = null;

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
    return msg + ' ' + args
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
}

// Créer un logger initial pour la phase de démarrage
const initialLogFile = pino.destination({
    dest: './data/initial.log',
    sync: false,
    mkdir: true
})

const baseLogger = pino({
    level: 'debug',
    timestamp: true,
    formatters: {
        level: (label) => {
            return { level: label }
        },
    }
}, pino.multistream([
    { stream: initialLogFile },
    {
        stream: pino.transport({
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
                colorizeObjects: true,
            }
        })
    }
]))

// Add caller information to logs
export const logger = caller(baseLogger, {
    relativeTo: join(__dirname, '..', '..', 'src'),
    stackAdjustment: 1,
})

export function setupConsoleLogger() {
    console.log = (msg: string, ...args: any[]) => logger.info(formatArgs(msg, args))
    console.info = (msg: string, ...args: any[]) => logger.info(formatArgs(msg, args))
    console.warn = (msg: string, ...args: any[]) => logger.warn(formatArgs(msg, args))
    console.error = (msg: string, ...args: any[]) => logger.error(formatArgs(msg, args))
    console.debug = (msg: string, ...args: any[]) => logger.debug(formatArgs(msg, args))
    console.table = (data: any) => logger.info(formatTable(data))
}

export function redirectLogsToBot(botUuid: string) {
    const pathManager = PathManager.getInstance(botUuid);
    const logPath = pathManager.getLogPath();
    
    // Copier les logs initiaux vers le nouveau fichier
    const fs = require('fs');
    fs.copyFileSync('./data/initial.log', logPath);
    
    // Supprimer initial.log après la copie
    fs.unlinkSync('./data/initial.log');
    
    // Créer le nouveau fichier de log en mode append
    const botLogFile = pino.destination({
        dest: logPath,
        sync: false,
        mkdir: true,
        append: true
    });

    // Créer un nouveau logger
    const newLogger = pino({
        level: 'debug',
        timestamp: true,
        formatters: {
            level: (label) => {
                return { level: label }
            },
        }
    }, pino.multistream([
        { stream: botLogFile },
        {
            stream: pino.transport({
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'SYS:standard',
                    ignore: 'pid,hostname',
                    colorizeObjects: true,
                }
            })
        }
    ]));

    // Mettre à jour le logger global
    Object.assign(logger, caller(newLogger, {
        relativeTo: join(__dirname, '..', '..', 'src'),
        stackAdjustment: 1,
    }));

    setupConsoleLogger();

    // Garder une référence au nouveau fichier de log
    currentBotLogFile = botLogFile;
}

// Gérer la fermeture propre des fichiers de log
export function setupExitHandler() {
    process.on('exit', () => {
        // Fermer le fichier de log initial
        if (initialLogFile) {
            initialLogFile.flushSync();
        }
        
        // Fermer le fichier de log du bot s'il existe
        if (currentBotLogFile) {
            currentBotLogFile.flushSync();
        }
    });
}