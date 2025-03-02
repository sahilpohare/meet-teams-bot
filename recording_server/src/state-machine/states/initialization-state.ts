import { generateBranding, playBranding } from '../../branding'
import { openBrowser } from '../../browser'
import { MeetingHandle } from '../../meeting'
import { JoinError, JoinErrorCode } from '../../types'
import { PathManager } from '../../utils/PathManager'
import { redirectLogsToBot } from '../../utils/pinoLogger'
import { MeetingStateType, StateExecuteResult } from '../types'
import { BaseState } from './base-state'

export class InitializationState extends BaseState {
    async execute(): StateExecuteResult {
        try {
            // Validate parameters
            if (!this.context.params.meeting_url) {
                throw new JoinError(JoinErrorCode.InvalidMeetingUrl)
            }

            // Initialize meeting handle if not exists
            if (!this.context.meetingHandle) {
                this.context.meetingHandle = new MeetingHandle(
                    this.context.params,
                )
            }

            // Setup branding if needed
            if (this.context.params.bot_branding) {
                await this.setupBranding()
            }

            // Setup path manager
            this.setupPathManager().then(() => {
                this.setupPinoLogger()
            })

            // Setup browser
            await this.setupBrowser()

            // All initialization successful
            return this.transition(MeetingStateType.WaitingRoom)
        } catch (error) {
            return this.handleError(error as Error)
        }
    }

    private async setupBranding(): Promise<void> {
        const { bot_name, custom_branding_bot_path } = this.context.params
        this.context.brandingProcess = generateBranding(
            bot_name,
            custom_branding_bot_path,
        )
        await this.context.brandingProcess.wait
        playBranding()
    }

    private async setupBrowser(): Promise<void> {
        try {
            // Définir le type de retour attendu de openBrowser
            type BrowserResult = {
                browser: any
                backgroundPage: any
            }

            // Créer une promesse qui se rejette après un délai
            const timeoutPromise = new Promise<BrowserResult>((_, reject) => {
                const id = setTimeout(() => {
                    clearTimeout(id)
                    reject(new Error('Browser setup timeout'))
                }, 30000)
            })

            // Exécuter la promesse d'ouverture du navigateur avec un timeout
            const result = await Promise.race<BrowserResult>([
                openBrowser(false, false),
                timeoutPromise,
            ])

            // Si on arrive ici, c'est que openBrowser a réussi
            this.context.browserContext = result.browser
            this.context.backgroundPage = result.backgroundPage
        } catch (error) {
            console.error('Browser setup failed or timed out:', error)
            throw error
        }
    }

    private async setupPathManager(): Promise<void> {
        if (!this.context.pathManager) {
            this.context.pathManager = PathManager.getInstance(
                this.context.params.bot_uuid,
            )
            await this.context.pathManager.ensureDirectories()
        }
    }

    private setupPinoLogger(): void {
        redirectLogsToBot(this.context.params.bot_uuid)
    }
}
