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