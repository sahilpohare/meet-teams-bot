import { spawn, } from "child_process"

export type BrandingHandle = {
    wait: Promise<void>;
    kill: () => void;
};

export function generateBranding(botname: string, custom_branding_path?: string): BrandingHandle {
    try {
        const command = (custom_branding_path != null) ? spawn('../generate_custom_branding.sh', [custom_branding_path], { env: { ...process.env } }) : spawn('../generate_branding.sh', [botname], { env: { ...process.env } })
        command.stderr.addListener("data", data => { console.log(data.toString()); });
        return {
            wait: new Promise<void>((res, _rej) => {
                command.on('close', () => {
                    res()
                })
            }),
            kill: () => {
                command.kill()
            }
        }
    } catch (e) {
        console.error('fail to generate branding ', e)
        return null
    }
}

export function playBranding(): BrandingHandle {
    try {
        const command = spawn('ffmpeg', ["-stream_loop", "-1", "-re", "-i", "../branding.mp4", "-f", "v4l2", "-vcodec", "rawvideo", "-s", "1280x720", "/dev/video10"])
        command.stderr.addListener("data", data => { console.log(data.toString()); });

        return {
            wait: new Promise<void>((res, _rej) => {
                command.on('close', () => {
                    res()
                })
            }),
            kill: () => {
                console.log('kill branding')
                command.kill("SIGKILL")
            }
        }
    } catch (e) {
        console.error('fail to generate branding ', e)
        return null
    }
}
