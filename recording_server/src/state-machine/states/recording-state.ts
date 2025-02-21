import { Events } from '../../events'
import { MEETING_CONSTANTS } from '../constants'

import { MeetingStateType, StateExecuteResult } from '../types'
import { BaseState } from './base-state'

export class RecordingState extends BaseState {
    private readonly CHECK_INTERVAL = 250 // 250ms

    async execute(): StateExecuteResult {
        try {
            console.info('Starting recording monitoring')

            while (true) {
                // Vérifier si la réunion doit se terminer
                const { shouldEnd, reason } = await this.checkEndConditions()

                if (shouldEnd) {
                    console.info(`Meeting end condition met: ${reason}`)
                    await this.handleMeetingEnd(reason)
                    return this.transition(MeetingStateType.Cleanup)
                }

                // Attendre avant la prochaine vérification
                await this.sleep(this.CHECK_INTERVAL)
            }
        } catch (error) {
            console.error('Error in recording state:', error)
            return this.handleError(error as Error)
        }
    }

    private async checkEndConditions(): Promise<{
        shouldEnd: boolean
        reason?: string
    }> {
        const now = Date.now()

        try {
            // Vérifier si le bot a été retiré
            if (await this.checkBotRemoved()) {
                return { shouldEnd: true, reason: 'bot_removed' }
            }

            // Vérifier s'il n'y a plus de participants
            if (await this.checkNoAttendees(now)) {
                return { shouldEnd: true, reason: 'no_attendees' }
            }

            // Vérifier s'il n'y a pas eu de son depuis longtemps
            if (await this.checkNoSpeaker(now)) {
                return { shouldEnd: true, reason: 'no_speaker' }
            }

            // Vérifier le timeout global de l'enregistrement
            if (this.checkRecordingTimeout(now)) {
                return { shouldEnd: true, reason: 'recording_timeout' }
            }

            return { shouldEnd: false }
        } catch (error) {
            console.error('Error checking end conditions:', error)
            return { shouldEnd: true, reason: 'error_during_check' }
        }
    }

    private async handleMeetingEnd(reason: string): Promise<void> {
        try {
            console.info(`Handling meeting end. Reason: ${reason}`)

            // Mettre à jour le contexte
            this.context.endReason = reason

            // Notifier de la fin de l'appel
            await Events.callEnded()

            // Arrêter l'audio streaming
            await this.stopAudioStreaming()
        } catch (error) {
            console.error('Error during meeting end handling:', error)
            throw error
        }
    }

    private async checkBotRemoved(): Promise<boolean> {
        if (!this.context.playwrightPage) {
            console.error('Playwright page not available')
            return true
        }

        try {
            return await this.context.provider.findEndMeeting(
                this.context.params,
                this.context.playwrightPage,
            )
        } catch (error) {
            console.error('Error checking if bot was removed:', error)
            return false
        }
    }

    /**
     * Vérifie si le meeting doit se terminer à cause d'un manque de participants
     * @param now Timestamp actuel
     * @returns true si le meeting doit se terminer
     */
    private checkNoAttendees(now: number): boolean {
        const attendeesCount = this.context.attendeesCount || 0
        const startTime = this.context.startTime || 0
        const firstUserJoined = this.context.firstUserJoined || false

        // Vrai si on a dépassé les 7 minutes initiales
        const noAttendeesTimeout =
            startTime + MEETING_CONSTANTS.INITIAL_WAIT_TIME < now
        // Vrai si au moins un utilisateur a rejoint puis est parti
        const noAttendeesAfterJoin = firstUserJoined

        console.log('--------------------------------')
        console.log('attendeesCount', attendeesCount)
        console.log('noAttendeesTimeout', noAttendeesTimeout)
        console.log('noAttendeesAfterJoin', noAttendeesAfterJoin)
        console.log('--------------------------------')

        // On termine si :
        // - Il n'y a personne actuellement ET
        // - Soit on a dépassé le timeout initial, soit quelqu'un était là mais est parti
        return (
            attendeesCount === 0 && (noAttendeesTimeout || noAttendeesAfterJoin)
        )
    }

    /**
     * Vérifie si le meeting doit se terminer à cause d'une absence de son
     * Plusieurs cas sont gérés :
     * 1. Avec participants : on vérifie juste le temps sans son (15 minutes)
     * 2. Sans participants : on vérifie le temps initial (7 minutes) ET le temps sans son (15 minutes)
     * 3. Si on a un timestamp de début de silence : on vérifie les 15 minutes de silence
     * @param now Timestamp actuel
     * @returns true si le meeting doit se terminer
     */
    private checkNoSpeaker(now: number): boolean {
        const startTime = this.context.startTime || 0
        const lastSpeakerTime = this.context.lastSpeakerTime
        const hasAttendees = this.context.attendeesCount > 0
        const noSpeakerDetectedTime = this.context.noSpeakerDetectedTime || 0
        const firstUserJoined = this.context.firstUserJoined || false

        console.log('--------------------------------')
        console.log('hasAttendees', hasAttendees)
        console.log('lastSpeakerTime', lastSpeakerTime)
        console.log('startTime', startTime)
        console.log('--------------------------------')

        // Cas 1 : Il y a des participants et on a un timestamp de dernière parole
        if (hasAttendees && lastSpeakerTime !== null) {
            // On vérifie uniquement si personne n'a parlé depuis 15 minutes
            return lastSpeakerTime + MEETING_CONSTANTS.SILENCE_TIMEOUT < now
        }

        // Cas 2 : On a un timestamp de dernière parole mais pas de participants qui ont rejoint l'appel
        if (lastSpeakerTime !== null && firstUserJoined === false) {
            return (
                // On vérifie les deux conditions :
                // - 7 minutes depuis le début du meeting
                startTime + MEETING_CONSTANTS.INITIAL_WAIT_TIME < now &&
                // - 15 minutes sans son
                lastSpeakerTime + MEETING_CONSTANTS.SILENCE_TIMEOUT < now
            )
        }

        // Cas 3 : On a un timestamp de début de silence
        if (noSpeakerDetectedTime !== null) {
            // On vérifie si ça fait 15 minutes qu'on n'a pas de son
            return (
                noSpeakerDetectedTime + MEETING_CONSTANTS.SILENCE_TIMEOUT < now
            )
        }

        // Cas par défaut : on ne termine pas le meeting
        // (c'est le cas si on n'a aucun timestamp valide)
        return false
    }

    private checkRecordingTimeout(now: number): boolean {
        const startTime = this.context.startTime || 0
        return startTime + MEETING_CONSTANTS.RECORDING_TIMEOUT < now
    }

    private async stopAudioStreaming(): Promise<void> {
        if (!this.context.backgroundPage) {
            console.error('Background page not available for stopping audio')
            return
        }

        try {
            await this.context.backgroundPage.evaluate(() => {
                const w = window as any
                return w.stopAudioStreaming()
            })
            console.info('Audio streaming stopped successfully')
        } catch (error) {
            console.error('Failed to stop audio streaming:', error)
            throw error
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms))
    }
}
