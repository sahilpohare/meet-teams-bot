import { Page } from '@playwright/test'
import { listenPage } from '../../browser/page-logger'
import { MeetingContext, MeetingStateType, StateExecuteResult } from '../types'

export abstract class BaseState {
    protected context: MeetingContext
    protected stateType: MeetingStateType

    constructor(context: MeetingContext, stateType: MeetingStateType) {
        this.context = context
        this.stateType = stateType

        this.setupPageLoggers()
    }

    private setupPageLoggers(): void {
        if (this.context.playwrightPage) {
            listenPage(this.context.playwrightPage)
            console.info(
                `Setup logger for main page in state ${this.stateType}`,
            )
        }

        if (this.context.backgroundPage) {
            // listenPage(this.context.backgroundPage);
            console.info(
                `Setup logger for background page in state ${this.stateType}`,
            )
        }
    }

    protected async setupNewPage(page: Page, pageName: string): Promise<void> {
        listenPage(page)
        console.info(`Setup logger for new page: ${pageName}`)
    }

    abstract execute(): StateExecuteResult

    protected transition(nextState: MeetingStateType): StateExecuteResult {
        return Promise.resolve({
            nextState,
            context: this.context,
        })
    }

    protected async handleError(error: Error): StateExecuteResult {
        console.error(`Error in state ${this.stateType}:`, error)
        this.context.error = error
        this.context.errorTime = Date.now()
        return this.transition(MeetingStateType.Error)
    }

    /**
     * Démarre un observateur qui surveille l'apparition des dialogues comme "Got it" 
     * et les gère automatiquement en arrière-plan
     */
    protected startDialogObserver() {
        // Ne démarrer l'observateur que pour Google Meet
        if (this.context.params.meetingProvider !== 'Meet') {
            console.info(`Dialog observer not started: provider is not Google Meet (${this.context.params.meetingProvider})`);
            return;
        }

        if (!this.context.playwrightPage) {
            console.warn('Cannot start dialog observer: page not available');
            return;
        }

        // Nettoyer tout observateur existant
        if (this.context.dialogObserverInterval) {
            clearInterval(this.context.dialogObserverInterval);
        }

        // Créer un nouvel observateur avec un intervalle de vérification
        console.info(`Starting dialog observer in state ${this.constructor.name}`);
        
        // Fonction pour vérifier et redémarrer l'observateur si nécessaire
        const checkAndRestartObserver = () => {
            if (!this.context.dialogObserverInterval) {
                console.warn('Dialog observer was stopped, restarting...');
                this.startDialogObserver();
                return;
            }
        };

        // Heartbeat pour vérifier l'état de l'observateur toutes les 2 secondes
        const heartbeatInterval = setInterval(checkAndRestartObserver, 2000);

        // Stocker l'intervalle de heartbeat pour pouvoir le nettoyer plus tard
        this.context.dialogObserverHeartbeat = heartbeatInterval;

        this.context.dialogObserverInterval = setInterval(async () => {
            try {
                if (this.context.playwrightPage?.isClosed()) {
                    this.stopDialogObserver();
                    return;
                }

                // Chercher le dialogue "Got it"
                const gotItDialog = this.context.playwrightPage.locator([
                    '[role="dialog"][aria-modal="true"][aria-label="Others may see your video differently"]',
                    '[role="dialog"]:has(button:has-text("Got it"))',
                    '[aria-modal="true"]:has(button:has-text("Got it"))'
                ].join(','));

                const isVisible = await gotItDialog.isVisible({ timeout: 300 }).catch(() => false);
                
                if (isVisible) {
                    console.info(`[DialogObserver] Found "Got it" dialog in state ${this.constructor.name}`);
                    
                    // Trouver le bouton Got it
                    const gotItButton = gotItDialog.locator('button:has-text("Got it")');
                    await gotItButton.click({ force: true, timeout: 1000 }).catch(async (err) => {
                        console.warn(`[DialogObserver] Failed to click with regular method: ${err.message}`);
                        
                        // Fallback: essayer de cliquer avec JavaScript directement
                        await this.context.playwrightPage.evaluate(() => {
                            const buttons = document.querySelectorAll('button');
                            for (const button of buttons) {
                                if (button.textContent?.includes('Got it')) {
                                    (button as HTMLElement).click();
                                    return true;
                                }
                            }
                            return false;
                        }).catch(e => console.error(`[DialogObserver] JavaScript click failed: ${e.message}`));
                    });
                    
                    console.info(`[DialogObserver] Clicked "Got it" button`);
                }
            } catch (error) {
                console.error(`[DialogObserver] Error checking for dialogs: ${error}`);
                // En cas d'erreur, on redémarre l'observateur
                this.stopDialogObserver();
                this.startDialogObserver();
            }
        }, 2000); // Vérifier toutes les 2 secondes
    }

    /**
     * Arrête l'observateur de dialogue
     */
    protected stopDialogObserver() {
        if (this.context.dialogObserverInterval) {
            clearInterval(this.context.dialogObserverInterval);
            this.context.dialogObserverInterval = undefined;
            console.info(`Stopped dialog observer in state ${this.constructor.name}`);
        }
        if (this.context.dialogObserverHeartbeat) {
            clearInterval(this.context.dialogObserverHeartbeat);
            this.context.dialogObserverHeartbeat = undefined;
            console.info(`Stopped dialog observer heartbeat in state ${this.constructor.name}`);
        }
    }
}
