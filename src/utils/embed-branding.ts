import { Page } from '@playwright/test'

// Extend Window interface for virtual camera
declare global {
    interface Window {
        __virtualCamera?: {
            canvas: HTMLCanvasElement
            stream: MediaStream
            originalGetUserMedia: typeof navigator.mediaDevices.getUserMedia
            imageDrawn?: boolean
            imageNotLoadedLogged?: boolean
        }
    }
}

/**
 * Main function to embed branding - runs asynchronously without blocking
 */
export async function embedBranding(
    page: Page,
    imageUrl: string,
): Promise<void> {
    // Start the branding process in the background without waiting
    await embedBrandingWithRetry(page, imageUrl).catch((error) => {
        console.warn(
            'Branding injection failed, continuing without branding:',
            error instanceof Error ? error.message : String(error),
        )
    })
}

/**
 * Async version with retry logic
 */
async function embedBrandingWithRetry(
    page: Page,
    imageUrl: string,
): Promise<void> {
    const maxRetries = 3
    const retryDelayMs = 30000 // 30 seconds

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.info(
                `Custom branding received, path: ${imageUrl}, attempting injection (attempt ${attempt}/${maxRetries})`,
            )

            // Check if page is ready before attempting injection
            if (!(await isPageReady(page))) {
                console.info(
                    `Page not ready on attempt ${attempt}, waiting ${retryDelayMs}ms before retry`,
                )
                if (attempt < maxRetries) {
                    await new Promise((resolve) =>
                        setTimeout(resolve, retryDelayMs),
                    )
                    continue
                } else {
                    throw new Error('Page never became ready after all retries')
                }
            }

            await injectVirtualCamera(page, imageUrl)
            console.info(
                'Virtual camera getUserMedia override installed successfully',
            )
            return
        } catch (error) {
            console.error(
                `Branding injection attempt ${attempt} failed:`,
                error instanceof Error ? error.message : String(error),
            )

            if (attempt < maxRetries) {
                console.info(`Retrying in ${retryDelayMs}ms...`)
                await new Promise((resolve) =>
                    setTimeout(resolve, retryDelayMs),
                )
            } else {
                console.error('All branding injection attempts failed')
                throw error
            }
        }
    }
}

/**
 * Check if the page is ready for injection
 */
async function isPageReady(page: Page): Promise<boolean> {
    try {
        // Check if page is still valid
        if (!page || page.isClosed()) {
            return false
        }

        // Check page ready state
        const readyState = await page.evaluate(() => document.readyState)
        console.info(`Page ready state: ${readyState}`)

        // Consider the page ready if it's at least 'interactive'
        return readyState === 'complete' || readyState === 'interactive'
    } catch (error) {
        console.warn(
            'Error checking page ready state:',
            error instanceof Error ? error.message : String(error),
        )
        return false
    }
}

/**
 * Inject the virtual camera functionality into the page
 */
async function injectVirtualCamera(
    page: Page,
    imageUrl: string,
): Promise<void> {
    const result = await page.evaluate((imageUrl) => {
        const logs: string[] = []

        // Override console.log to capture logs
        const originalConsoleLog = console.log
        console.log = (...args) => {
            logs.push(args.join(' '))
            originalConsoleLog.apply(console, args)
        }

        try {
            console.log(
                '🎥 🎬 ===== WAITING-ROOM VIRTUAL CAMERA INJECTION =====',
            )
            console.log('🎥 📅 Page injection time:', new Date().toISOString())
            console.log('🎥 🌐 Page URL:', window.location.href)
            console.log('🎥 📄 Page ready state:', document.readyState)

            // Override getUserMedia immediately to prevent "Camera not found"
            const originalGetUserMedia = navigator.mediaDevices.getUserMedia

            // Load the branding image
            let brandingImage = null
            let imageLoaded = false

            if (imageUrl) {
                console.log('🎥 📸 Loading branding image from:', imageUrl)
                brandingImage = new Image()
                brandingImage.crossOrigin = 'anonymous'
                brandingImage.onload = () => {
                    imageLoaded = true
                    console.log(
                        '🎥 ✅ WAITING-ROOM Branding image loaded successfully',
                        `Dimensions: ${brandingImage.width}x${brandingImage.height}`,
                    )
                }
                brandingImage.onerror = (error) => {
                    console.log(
                        '🎥 ❌ WAITING-ROOM Failed to load branding image, continuing without it',
                        error,
                    )
                }

                // Add a small delay to ensure proper initialization timing
                setTimeout(() => {
                    brandingImage.src = imageUrl
                    console.log('🎥 🔄 WAITING-ROOM Image loading started...')
                }, 10)
            } else {
                console.log('🎥 ⚠️ No imageUrl provided')
            }

            navigator.mediaDevices.getUserMedia = async function (constraints) {
                console.log(
                    '🎥 ===== WAITING-ROOM getUserMedia INTERCEPTED =====',
                )
                console.log('🎥 Constraints:', JSON.stringify(constraints))

                if (constraints.video) {
                    console.log('🎥 🎬 WAITING-ROOM VIDEO REQUEST DETECTED!')

                    // Create virtual camera if not already created
                    if (!window.__virtualCamera) {
                        console.log(
                            '🎥 🚀 WAITING-ROOM Creating virtual camera on demand...',
                        )

                        // Create virtual camera canvas
                        const canvas = document.createElement('canvas')
                        canvas.width = 1280
                        canvas.height = 720
                        canvas.style.position = 'absolute'
                        canvas.style.top = '-9999px'
                        canvas.style.left = '-9999px'
                        document.body.appendChild(canvas)

                        const ctx = canvas.getContext('2d')
                        if (!ctx) {
                            console.error('Failed to get canvas context')
                            return originalGetUserMedia.call(this, constraints)
                        }

                        // Simple rendering function
                        function render() {
                            // Clear canvas
                            ctx.fillStyle = '#000'
                            ctx.fillRect(0, 0, canvas.width, canvas.height)

                            // Draw branding image if available
                            if (brandingImage && imageLoaded) {
                                // Calculate image dimensions to fit canvas while maintaining aspect ratio
                                const imgAspectRatio =
                                    brandingImage.width / brandingImage.height
                                const canvasAspectRatio =
                                    canvas.width / canvas.height

                                let drawWidth, drawHeight, x, y

                                if (imgAspectRatio > canvasAspectRatio) {
                                    // Image is wider than canvas
                                    drawWidth = canvas.width
                                    drawHeight = canvas.width / imgAspectRatio
                                    x = 0
                                    y = (canvas.height - drawHeight) / 2
                                } else {
                                    // Image is taller than canvas
                                    drawHeight = canvas.height
                                    drawWidth = canvas.height * imgAspectRatio
                                    x = (canvas.width - drawWidth) / 2
                                    y = 0
                                }

                                ctx.drawImage(
                                    brandingImage,
                                    x,
                                    y,
                                    drawWidth,
                                    drawHeight,
                                )

                                // Log drawing info (only once to avoid spam)
                                if (!window.__virtualCamera?.imageDrawn) {
                                    console.log(
                                        '🎥 🎨 WAITING-ROOM Drawing branding image:',
                                        {
                                            originalSize: `${brandingImage.width}x${brandingImage.height}`,
                                            canvasSize: `${canvas.width}x${canvas.height}`,
                                            drawSize: `${drawWidth}x${drawHeight}`,
                                            position: `(${x}, ${y})`,
                                        },
                                    )
                                    if (window.__virtualCamera) {
                                        window.__virtualCamera.imageDrawn = true
                                    }
                                }
                            } else if (brandingImage && !imageLoaded) {
                                // Log when image is not loaded yet
                                if (
                                    !window.__virtualCamera
                                        ?.imageNotLoadedLogged
                                ) {
                                    console.log(
                                        '🎥 ⏳ WAITING-ROOM Branding image not loaded yet, showing black background',
                                    )
                                    if (window.__virtualCamera) {
                                        window.__virtualCamera.imageNotLoadedLogged =
                                            true
                                    }
                                }
                            }

                            requestAnimationFrame(render)
                        }

                        // Start rendering
                        render()

                        // Create media stream from canvas
                        const stream = canvas.captureStream(30)

                        // Store reference
                        window.__virtualCamera = {
                            canvas,
                            stream,
                            originalGetUserMedia,
                        }

                        console.log(
                            '🎥 ✅ WAITING-ROOM Virtual camera created and ready',
                        )
                    }

                    console.log(
                        '🎥 ✅ WAITING-ROOM Providing virtual video stream',
                    )
                    console.log(
                        '🎥 Stream tracks:',
                        window.__virtualCamera.stream
                            .getTracks()
                            .map((t) => t.kind),
                    )
                    console.log(
                        '🎥 🎬 WAITING-ROOM Virtual camera stream requested and provided',
                    )
                    return window.__virtualCamera.stream
                } else {
                    console.log(
                        '🎥 📻 WAITING-ROOM Audio-only request, not intercepting',
                    )
                }

                console.log(
                    '🎥 🔄 WAITING-ROOM Falling back to original getUserMedia',
                )
                try {
                    const result = await originalGetUserMedia.call(
                        this,
                        constraints,
                    )
                    console.log(
                        '🎥 ✅ WAITING-ROOM Original getUserMedia succeeded',
                    )
                    return result
                } catch (error) {
                    console.log(
                        '🎥 ❌ WAITING-ROOM Original getUserMedia failed:',
                        error instanceof Error ? error.message : String(error),
                    )
                    throw error
                }
            }

            console.log(
                '🎥 ✅ WAITING-ROOM Virtual camera getUserMedia override installed',
            )

            // Override enumerateDevices to show our virtual camera
            const originalEnumerateDevices =
                navigator.mediaDevices.enumerateDevices
            navigator.mediaDevices.enumerateDevices = async function () {
                console.log(
                    '🎥 📋 WAITING-ROOM enumerateDevices called - intercepting...',
                )
                const devices = await originalEnumerateDevices.call(this)
                console.log(
                    '🎥 📋 WAITING-ROOM Original devices:',
                    devices.map((d) => ({
                        kind: d.kind,
                        label: d.label,
                    })),
                )

                // Add our virtual camera to the list
                const virtualVideoDevice = {
                    deviceId: 'virtual-camera-123',
                    kind: 'videoinput' as MediaDeviceKind,
                    label: 'Virtual Camera (Meeting Bot)',
                    groupId: 'virtual-camera-group',
                    toJSON: function () {
                        return this
                    },
                } as MediaDeviceInfo

                const enhancedDevices = [...devices, virtualVideoDevice]
                console.log(
                    '🎥 📋 WAITING-ROOM Enhanced devices with virtual camera:',
                    enhancedDevices.map((d) => ({
                        kind: d.kind,
                        label: d.label,
                    })),
                )
                return enhancedDevices
            }
            console.log(
                '🎥 ✅ WAITING-ROOM Virtual camera enumerateDevices override installed',
            )

            // Force camera detection by periodically calling getUserMedia
            console.log(
                '🎥 🔄 WAITING-ROOM Setting up periodic camera detection...',
            )
            setTimeout(() => {
                console.log(
                    '🎥 🔄 WAITING-ROOM Triggering periodic camera detection...',
                )
                navigator.mediaDevices
                    .getUserMedia({ video: true })
                    .then((stream) => {
                        console.log(
                            '🎥 ✅ WAITING-ROOM Periodic camera detection succeeded',
                        )
                        stream.getTracks().forEach((track) => track.stop())
                    })
                    .catch((error) => {
                        console.log(
                            '🎥 ❌ WAITING-ROOM Periodic camera detection failed:',
                            error.message,
                        )
                    })
            }, 2000) // Wait 2 seconds then try to detect camera

            return {
                success: true,
                message: 'Virtual camera setup completed',
                logs,
            }
        } catch (error) {
            console.error('🎥 ❌ Error in page evaluation:', error)
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                logs,
            }
        }
    }, imageUrl)

    if (!result.success) {
        throw new Error(
            result.error || 'Unknown error in virtual camera injection',
        )
    }

    // Log the captured browser logs
    if (result.logs && result.logs.length > 0) {
        console.info('Browser-side branding logs:')
        result.logs.forEach((log) => {
            console.info(`  ${log}`)
        })
    }
}
