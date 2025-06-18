import { Page } from '@playwright/test'
import { MeetingProvider, RecordingMode, SpeakerData } from '../types'
import { MeetSpeakersObserver } from './meet/speakersObserver'
import { TeamsSpeakersObserver } from './teams/speakersObserver'

export class SpeakersObserver {
    private meetingProvider: MeetingProvider
    private observer: MeetSpeakersObserver | TeamsSpeakersObserver | null = null
    private isObserving: boolean = false

    constructor(meetingProvider: MeetingProvider) {
        this.meetingProvider = meetingProvider
    }

    public async startObserving(
        page: Page,
        recordingMode: RecordingMode,
        botName: string,
        onSpeakersChange: (speakers: SpeakerData[]) => void,
    ): Promise<void> {
        if (this.isObserving) {
            console.warn('Speakers observer already running')
            return
        }

        console.log(`Starting speakers observation for ${this.meetingProvider}...`)

        // Create the appropriate observer based on meeting provider
        switch (this.meetingProvider) {
            case 'Meet':
                this.observer = new MeetSpeakersObserver(
                    page,
                    recordingMode,
                    botName,
                    onSpeakersChange,
                )
                break

            case 'Teams':
                this.observer = new TeamsSpeakersObserver(
                    page,
                    recordingMode,
                    botName,
                    onSpeakersChange,
                )
                break

            case 'Zoom':
                console.warn('Zoom speakers observation not implemented yet')
                return

            default:
                throw new Error(`Unknown meeting provider: ${this.meetingProvider}`)
        }

        if (this.observer) {
            await this.observer.startObserving()
            this.isObserving = true
            console.log(`Speakers observation started for ${this.meetingProvider}`)
        }
    }

    public stopObserving(): void {
        if (!this.isObserving || !this.observer) {
            return
        }

        console.log(`Stopping speakers observation for ${this.meetingProvider}...`)
        this.observer.stopObserving()
        this.observer = null
        this.isObserving = false
        console.log(`Speakers observation stopped for ${this.meetingProvider}`)
    }

    public isCurrentlyObserving(): boolean {
        return this.isObserving
    }
} 