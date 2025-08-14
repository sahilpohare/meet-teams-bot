import { Page } from '@playwright/test'
import * as fs from 'fs/promises'
import * as path from 'path'
import { PathManager } from '../utils/PathManager'

export interface HtmlSnapshotResult {
    success: boolean
}

const SNAPSHOT_TIMEOUT = 10000

export class HtmlSnapshotService {
    private static instance: HtmlSnapshotService
    private pathManager: PathManager

    private constructor() {
        this.pathManager = PathManager.getInstance()
    }

    public static getInstance(): HtmlSnapshotService {
        if (!HtmlSnapshotService.instance) {
            HtmlSnapshotService.instance = new HtmlSnapshotService()
        }
        return HtmlSnapshotService.instance
    }

    /**
     * Capture HTML snapshot before DOM manipulation
     */
    public async captureSnapshot(
        page: Page,
        context: string
    ): Promise<HtmlSnapshotResult> {
        // Wrap entire operation with 10-second timeout using Promise.race
        // This is necessary because page.content() doesn't support timeout/AbortController
        return Promise.race([
            this.performSnapshot(page, context),
            new Promise<HtmlSnapshotResult>((_, reject) =>
                setTimeout(() => reject(new Error(`Snapshot operation timeout after ${SNAPSHOT_TIMEOUT/1000} seconds`)), SNAPSHOT_TIMEOUT)
            )
        ]).catch((error) => {
            console.error(`[HtmlSnapshot] Failed to capture snapshot for ${context}, skipping:`, error.message)
            return {
                success: false
            }
        })
    }

    /**
     * Internal method to perform the actual snapshot operation
     */
    private async performSnapshot(
        page: Page,
        context: string
    ): Promise<HtmlSnapshotResult> {
        // Check if page is still valid
        if (page.isClosed()) {
            console.warn('[HtmlSnapshot] Cannot capture snapshot: page is closed')
            return {
                success: false
            }
        }

        // Additional page state checks
        try {
            await page.evaluate(() => document.readyState, { timeout: 1000 })
        } catch (evalError) {
            console.warn(`[HtmlSnapshot] Page not responsive for ${context}, skipping snapshot`)
            return {
                success: false
            }
        }

        console.log(`[HtmlSnapshot] Capturing snapshot for ${context}`)

        // Capture HTML content
        const html = await page.content()
        
        // Generate filename
        const filename = this.generateFilename(context)
        const filePath = path.join(this.pathManager.getHtmlSnapshotsPath(), filename)
        
        // Ensure directory exists
        await fs.mkdir(path.dirname(filePath), { recursive: true })
        
        // Save HTML file
        await fs.writeFile(filePath, html, 'utf-8')
        
        console.log(`[HtmlSnapshot] Captured snapshot: ${filename}`)
        
        return {
            success: true
        }
    }

    
    /**
     * Generate filename for snapshot
     */
    private generateFilename(context: string): string {
        const timestamp = Date.now()
        return `${context}_${timestamp}.html`
    }

}
