import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk'
import { RecognizerResult } from 'spoke_api_js'

/**
 * A wrapper around Microsoft's speech SDK: emits language and words from audio data.
 *
 * No defensive code:
 * call `await recognizer.start()`, `recognizer.write(...)` and `await recognizer.stop()`
 * IN THAT ORDER.
 *
 */
export class Recognizer {
    private recognizer: SpeechSDK.SpeechRecognizer
    private pushStream: SpeechSDK.PushAudioInputStream
    private waitForSessionStoped: Promise<void>

    /** Returns a new `Recognizer`. */
    constructor({
        token,
        region,
        sampleRate,
        language,
        vocabulary,
        onResult,
        onCancel,
    }: {
        token: string
        region: string
        sampleRate: number
        vocabulary: string[]
        language: string
        onResult: (json: string) => void
        onCancel: (e: any) => void
    }) {
        this.pushStream = SpeechSDK.AudioInputStream.createPushStream(
            SpeechSDK.AudioStreamFormat.getWaveFormat(
                sampleRate,
                16,
                1,
                SpeechSDK.AudioFormatTag.PCM, //ALAW and MULAW should also work
            ),
        )
        this.recognizer = SpeechSDK.SpeechRecognizer.FromConfig(
            ((
                token: string,
                region: string,
                language: string,
            ): SpeechSDK.SpeechConfig => {
                const speechConfig =
                    SpeechSDK.SpeechConfig.fromAuthorizationToken(token, region)
                if (!speechConfig) {
                    throw 'error'
                }

                speechConfig.outputFormat = SpeechSDK.OutputFormat.Detailed
                speechConfig.requestWordLevelTimestamps()
                speechConfig.setProfanity(SpeechSDK.ProfanityOption.Raw)
                speechConfig.speechRecognitionLanguage = language
                speechConfig.setProperty(
                    SpeechSDK.PropertyId.SpeechServiceConnection_LanguageIdMode,
                    'Continuous',
                )

                return speechConfig
            })(token, region, language),
            SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages([
                'en-US',
                'fr-FR',
                'es-ES',
                language,
            ]),
            SpeechSDK.AudioConfig.fromStreamInput(this.pushStream),
        )
        this.recognizer.recognized = (_, event) => onResult(event.result.json)
        this.recognizer.canceled = (e) => onCancel(e)
        const sessionStoppedPromise = new Promise((resolve, reject) => {
            this.recognizer.sessionStopped = (s, e) => {
                console.log('\n    Session stopped event.')
                resolve('Session stopped')
            }
        })

        this.waitForSessionStoped = sessionStoppedPromise

        // API cancels recognizer if dictionary is empty
        if (vocabulary?.length > 0) {
            SpeechSDK.PhraseListGrammar.fromRecognizer(
                this.recognizer,
            ).addPhrases(vocabulary)
        }
    }

    /** Starts the recognition and returns the session id. */
    async start(): Promise<void> {
        console.log('starting a new recognizer')
        return await new Promise((resolve, reject) => {
            this.recognizer.startContinuousRecognitionAsync(
                async () => {
                    console.log('a new recognizer has started')
                    resolve()
                },
                (error) => {
                    console.error('[Recognizer] START FAILED:', error)
                    reject()
                },
            )
        })
    }

    /** Writes `data` to the recognizer. */
    write(data: ArrayBuffer): void {
        this.pushStream.write(data)
    }

    /** Stops the recognition and returns the session id. */
    async stop(): Promise<void> {
        await new Promise((resolve, reject) => {
            console.log('stopping recognizer')
            this.recognizer.stopContinuousRecognitionAsync(
                async () => {
                    console.log('recognizer has stopped')
                    resolve()
                },
                (error) => {
                    console.error('[Recognizer] STOP FAILED:', error)
                    reject()
                },
            )
        })
        await this.waitForSessionStoped
        console.log('after this.waitForSessionStoped')
    }
}

/**
 * Allows creation and recreaction of `Recognizer` with buffered results.
 */
export class RecognizerSession {
    private recognizer: Recognizer | null
    private oldRecognizer: Recognizer | null
    private results: RecognizerResult[]

    /** Returns a new `RecognizerSession`. */
    constructor() {
        this.recognizer = null
        this.results = []
    }

    /** Starts the recognizer. */
    async start({
        token,
        region,
        language,
        sampleRate,
        offset,
        vocabulary,
    }: {
        token: string
        region: string
        sampleRate: number
        language: string
        offset: number
        vocabulary: string[]
    }): Promise<void> {
        // Prevents garbage collection, we need those handlers
        this.oldRecognizer = this.recognizer
        this.oldRecognizer // Suppress `unused` warning

        this.recognizer = new Recognizer({
            language,
            token,
            region,
            sampleRate,
            vocabulary,
            onResult: (json) => this.results.push({ offset, json }),
            onCancel: (e) => console.error('transcription cancelled', e),
        })

        await this.recognizer.start()
    }

    /** Writes `data` to the recognizer. */
    write(data: ArrayBuffer): void {
        this.recognizer.write(data)
    }

    /** Stops the recognizer. */
    async stop(): Promise<void> {
        await this.recognizer.stop()
    }

    /** Returns the detected languaages and recognized words. */
    getResults(): RecognizerResult[] {
        return this.results.splice(0)
    }
}
