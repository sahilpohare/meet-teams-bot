import { StateExecuteResult } from '../types'
import { BaseState } from './base-state'

export class TerminatedState extends BaseState {
    async execute(): StateExecuteResult {
        console.info('Meeting state machine terminated')

        // This state is terminal and does not transition to another state
        // Return null or an object indicating termination
        return { nextState: null, context: this.context }
    }
}
