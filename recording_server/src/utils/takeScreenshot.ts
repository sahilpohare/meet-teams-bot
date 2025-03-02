import { Page } from '@playwright/test'
import * as path from 'path'
import { PathManager } from '../utils/PathManager'
import { s3cp } from '../s3'

export async function takeScreenshot(page: Page, name: string) {
    try {
        const pathManager = PathManager.getInstance()
        const date = new Date()
            .toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
            })
            .replace(/\//g, '-')

        // Construire le chemin du fichier en utilisant PathManager
        const screenshotPath = path.join(
            pathManager.getBasePath(),
            `screenshot_${name.replaceAll('/', '')}_${date}.jpg`,
        )

        // Prendre la capture d'écran avec Playwright
        await page.screenshot({
            path: screenshotPath,
            timeout: 5000,
            animations: 'disabled',
            scale: 'css',
        })

        // Obtenir les chemins S3 depuis PathManager
        const { bucketName, s3Path } = pathManager.getS3Paths()
        const s3FilePath = `${s3Path}/screenshot_${name.replaceAll('/', '')}_${date}.jpg`

        // Upload vers S3
        await s3cp(screenshotPath, s3FilePath).catch((e) => {
            console.error(`Failed to upload screenshot to s3: ${e}`)
        })
    } catch (e) {
        console.error(`Failed to take screenshot: ${e}`)
    }
}
