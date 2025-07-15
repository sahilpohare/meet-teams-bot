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

    protected startDialogObserver() {
        // Use the global observer instead of creating a local one
        if (this.context.dialogObserver) {
            console.info(
                `[BaseState] Starting global dialog observer in state ${this.constructor.name}`,
            )
            this.context.dialogObserver.setupGlobalDialogObserver()
        } else {
            console.warn(
                `[BaseState] Global dialog observer not available in state ${this.constructor.name}`,
            )
        }
    }

    protected stopDialogObserver() {
        if (this.context.dialogObserver) {
            console.info(
                `[BaseState] Stopping global dialog observer in state ${this.constructor.name}`,
            )
            this.context.dialogObserver.stopGlobalDialogObserver()
        } else {
            console.warn(
                `[BaseState] Global dialog observer not available in state ${this.constructor.name}`,
            )
        }
    }
}
