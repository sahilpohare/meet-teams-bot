import { spawn } from 'child_process'

export function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

export class Console {
    constructor() {}
    protected log(...args: any[]): void {
        console.log(`[${this.constructor.name}]`, ...args)
    }
    protected info(...args: any[]): void {
        console.info(`[${this.constructor.name}]`, ...args)
    }
    protected warn(...args: any[]): void {
        console.warn(`[${this.constructor.name}]`, ...args)
    }
    protected error(...args: any[]): void {
        console.error(`[${this.constructor.name}]`, ...args)
    }
}

export async function delete_s3_file(s3Path: string, bucketName: string) {
    try {
        await deleteFromS3(bucketName, s3Path)
    } catch (error) {
        console.error('Erreur lors de la suppression du fichier S3:', error)
        throw error
    }
}

function deleteFromS3(bucketName: string, s3Path: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const s3FullPath = `s3://${bucketName}/${s3Path}`

        const awsCommand = spawn('aws', ['s3', 'rm', s3FullPath])

        let errorOutput = ''

        awsCommand.stderr.on('data', (data) => {
            errorOutput += data.toString()
        })

        awsCommand.on('close', (code) => {
            if (code === 0) {
                console.log(`Fichier supprimé avec succès: ${s3FullPath}`)
                resolve()
            } else {
                console.error(
                    'Erreur lors de la suppression du fichier S3:',
                    errorOutput,
                )
                reject(
                    new Error(
                        `Échec de la suppression S3 avec le code ${code}`,
                    ),
                )
            }
        })
    })
}

// import * as fs from 'fs'
// import { relative, resolve } from 'path'
//
// export async function* getFiles(dir) {
//     const dirents = await fs.promises.readdir(dir, { withFileTypes: true })
//     for (const dirent of dirents) {
//         const res = resolve(dir, dirent.name)
//         if (dirent.isDirectory()) {
//             yield* getFiles(res)
//         } else {
//             yield relative(process.cwd(), res)
//         }
//     }
// }

// import { ChildProcess, spawn } from 'child_process'
//
// export const BUCKET_NAME = 'spoke-log-bot'
//
// export async function s3cp(local: string, s3path: string) {
//     await new Promise<void>((res, rej) => {
//         const command: ChildProcess = spawn('aws', [
//             's3',
//             'cp',
//             '--acl',
//             'public-read',
//             local,
//             `s3://${BUCKET_NAME}/${s3path}`,
//         ])
//         command.on('close', (state) => {
//             if (state === 0) {
//                 res()
//             } else {
//                 console.error('Bad return value : ', state)
//                 rej()
//             }
//         })
//         command.on('error', (err) => {
//             console.error('s3cp error:', err)
//             rej()
//         })
//     })
// }

// ['log', 'warn', 'error'].forEach((methodName) => {
//    const originalMethod = console[methodName];
//    console[methodName] = (...args) => {
//        let initiator = 'unknown place';
//        try {
//            throw new Error();
//        } catch (e) {
//            if (typeof e.stack === 'string') {
//                let isFirst = true;
//                for (const line of e.stack.split('\n')) {
//                    const matches = line.match(/^\s+at\s+(.*)/);
//                    if (matches) {
//                        if (!isFirst) { // first line - current function
//                            // second line - caller (what we are looking for)
//                            initiator = matches[1].trim().substr(3);
//                            break;
//                        }
//                        isFirst = false;
//                    }
//                }
//            }
//        }
//        originalMethod.apply(console, [...args, '\n', `  at ${initiator}`]);
//    };
// });
