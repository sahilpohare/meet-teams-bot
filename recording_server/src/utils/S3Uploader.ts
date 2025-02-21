import { spawn } from 'child_process';
import { EventEmitter } from 'events';

export class S3Uploader extends EventEmitter {
    public async uploadFile(
        filePath: string,
        bucketName: string,
        s3Path: string
    ): Promise<string> {
        const s3FullPath = `s3://${bucketName}/${s3Path}`;

        return new Promise((resolve, reject) => {
            const args = [
                's3',
                'cp',
                filePath,
                s3FullPath,
                '--acl',
                'public-read'
            ];

            if (process.env.S3_ARGS) {
                args.unshift(...process.env.S3_ARGS.split(' '));
            }

            const awsProcess = spawn('aws', args);
            let output = '';

            awsProcess.stdout.on('data', (data) => {
                output += data.toString();
                this.emit('progress', data.toString());
            });
            awsProcess.stderr.on('data', (data) => {
                output += data.toString();
                this.emit('error', data.toString());
            });

            awsProcess.on('close', (code) => {
                if (code === 0) {
                    const publicUrl = `https://${bucketName}.s3.amazonaws.com/${s3Path}`;
                    resolve(publicUrl);
                } else {
                    reject(new Error(`S3 upload failed (${code}): ${output}`));
                }
            });
        });
    }
}