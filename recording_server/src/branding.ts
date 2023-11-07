import { spawn } from 'child_process'

export type BrandingHandle = {
    wait: Promise<void>
    kill: () => void
}

export function generateBranding(
    botname: string,
    custom_branding_path?: string,
): BrandingHandle {
    try {
        const command = (() => {
            if (custom_branding_path == null) {
                return spawn('../generate_branding.sh', [botname], {
                    env: { ...process.env },
                })
            } else {
                return spawn(
                    '../generate_custom_branding.sh',
                    [custom_branding_path],
                    { env: { ...process.env } },
                )
            }
        })()
        command.stderr.addListener('data', (data) => {
            console.log(data.toString())
        })

        return {
            wait: new Promise<void>((res) => {
                command.on('close', () => {
                    res()
                })
            }),
            kill: () => {
                command.kill()
            },
        }
    } catch (e) {
        console.error('fail to generate branding ', e)
        return null
    }
}

export function playBranding(): BrandingHandle {
    try {
        // Don't pipe stderr to console: it never stops printing
        const command = spawn('../play_branding_on_webcam.sh')

        return {
            wait: new Promise<void>((res, _rej) => {
                command.on('close', () => {
                    res()
                })
            }),
            kill: () => {
                console.log('kill branding')
                command.kill('SIGKILL')
            },
        }
    } catch (e) {
        console.error('fail to generate branding ', e)
        return null
    }
}
