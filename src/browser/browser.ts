import { BrowserContext, chromium } from '@playwright/test'

export async function openBrowser(
    slowMo: boolean = false,
): Promise<{ browser: BrowserContext }> {
    const width = 1280 // 640
    const height = 720 // 480

    // Log additional debugging information
    console.error('Environment at start up:', {
        DISPLAY: process.env.DISPLAY,
        HOME: process.env.HOME,
        USER: process.env.USER,
        CHROME_PATH: process.env.CHROME_PATH,
        CHROME_DEVEL_SANDBOX: process.env.CHROME_DEVEL_SANDBOX,
        PWD: process.env.PWD,
        PATH: process.env.PATH,
        VIRTUAL_MIC: process.env.VIRTUAL_MIC,
        VIDEO_DEVICE: process.env.VIDEO_DEVICE,
        ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN,
        S3_ARGS: process.env.S3_ARGS,
        S3_BUCKET: process.env.S3_BUCKET,
        S3_ENDPOINT: process.env.S3_ENDPOINT,
        S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
        S3_SECRET_KEY: process.env.S3_SECRET_KEY,
        S3_REGION: process.env.S3_REGION,
        VIRTUAL_SPEAKER_MONITOR: process.env.VIRTUAL_SPEAKER_MONITOR,
        AWS_S3_VIDEO_BUCKET: process.env.AWS_S3_VIDEO_BUCKET,
        AWS_S3_AUDIO_BUCKET: process.env.AWS_S3_AUDIO_BUCKET,
        AWS_S3_TRANSCRIPTION_BUCKET: process.env.AWS_S3_TRANSCRIPTION_BUCKET,
        AWS_S3_SCREENSHOT_BUCKET: process.env.AWS_S3_SCREENSHOT_BUCKET,
    })

    try {
        console.log('Launching persistent context with exact extension args...')

        // Get Chrome path from environment variable or use default
        const chromePath = process.env.CHROME_PATH || '/usr/bin/google-chrome'
        console.log(`🔍 Using Chrome path: ${chromePath}`)

        const context = await chromium.launchPersistentContext('', {
            headless: false,
            viewport: { width, height },
            executablePath: chromePath,
            args: [
                // Security configurations
                '--no-sandbox',
                '--disable-setuid-sandbox',

                // ========================================
                // AUDIO CONFIGURATION FOR PULSEAUDIO
                // ========================================
                '--use-pulseaudio', // Force Chromium to use PulseAudio
                '--enable-audio-service-sandbox=false', // Disable audio service sandbox for virtual devices
                '--audio-buffer-size=2048', // Set buffer size for better audio handling
                '--disable-features=AudioServiceSandbox', // Additional sandbox disable
                '--autoplay-policy=no-user-gesture-required', // Allow autoplay for meeting platforms

                // WebRTC optimizations (required for meeting audio/video capture)
                '--disable-rtc-smoothness-algorithm',
                '--disable-webrtc-hw-decoding',
                '--disable-webrtc-hw-encoding',
                '--enable-webrtc-capture-audio', // Ensure WebRTC can capture audio
                '--force-webrtc-ip-handling-policy=default', // Better WebRTC handling

                // Performance and resource management optimizations
                '--disable-blink-features=AutomationControlled',
                '--disable-background-timer-throttling',
                '--enable-features=SharedArrayBuffer',
                '--memory-pressure-off', // Disable memory pressure handling for consistent performance
                '--max_old_space_size=4096', // Increase V8 heap size to 4GB for large meetings
                '--disable-background-networking', // Reduce background network activity
                '--disable-features=TranslateUI', // Disable translation features to save resources
                '--disable-features=AutofillServerCommunication', // Disable autofill to reduce network usage
                '--disable-component-extensions-with-background-pages', // Reduce background extension overhead
                '--disable-default-apps', // Disable default Chrome apps
                '--renderer-process-limit=4', // Limit renderer processes to prevent resource exhaustion
                '--disable-ipc-flooding-protection', // Improve IPC performance for high-frequency operations
                '--aggressive-cache-discard', // Enable aggressive cache management for memory efficiency
                '--disable-features=MediaRouter', // Disable media router for reduced overhead

                // Certificate and security optimizations for meeting platforms
                '--ignore-certificate-errors',
                '--allow-insecure-localhost',
                '--disable-blink-features=TrustedDOMTypes',
                '--disable-features=TrustedScriptTypes',
                '--disable-features=TrustedHTML',

                // Kubernetes-specific arguments for containerized environments
                '--disable-dev-shm-usage', // Critical: Disable /dev/shm usage (Kubernetes has small limits)
                '--disable-gpu', // Disable GPU acceleration for containers
                '--disable-extensions', // Disable extensions for stability
                '--disable-plugins', // Disable plugins
                '--disable-web-security', // Disable web security for meeting platforms
                '--allow-running-insecure-content', // Allow insecure content

                // Additional audio debugging (remove in production)
                '--enable-logging=stderr',
                '--log-level=1',
                '--vmodule=*audio*=3', // Enable audio debug logging
            ],
            slowMo: slowMo ? 100 : undefined,
            permissions: ['microphone', 'camera'],
            ignoreHTTPSErrors: true,
            acceptDownloads: true,
            bypassCSP: true,
            timeout: 120000,
        })

        console.log('✅ Chromium launched with PulseAudio configuration')
        return { browser: context }
    } catch (error) {
        console.error('Failed to open browser:', error)

        // Provide more detailed error information
        if (error instanceof Error) {
            console.error('Error details:', {
                message: error.message,
                stack: error.stack,
                name: error.name,
            })
        }

        throw error
    }
}
