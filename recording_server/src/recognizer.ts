import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk'
import { RecognizerWord, RecognizerResults } from 'spoke_api_js'

type RecognizerOptions = {
  token: string
  region: string
  sampleRate: number
  dictionary: string[]
  language: string
  onLanguage: (language: string) => void
  onWords: (words: RecognizerWord[]) => void
  onCancel: () => void
}

/**
* A wrapper around Microsoft's speech SDK: emits language and words from audio data.
*
* Usage: call `await recognizer.start()`, `recognizer.write(...)`, `await recognizer.stop()` IN THAT ORDER.
*/
export class Recognizer {
  private recognizer: SpeechSDK.SpeechRecognizer
  private pushStream: SpeechSDK.PushAudioInputStream
  private onLanguage: (language: string) => void
  private onWords: (words: RecognizerWord[]) => void

  /** Returns a new `Recognizer`. */
  constructor({ token, region, sampleRate, language, dictionary, onLanguage, onWords, onCancel }: RecognizerOptions) {
    this.onLanguage = onLanguage
    this.onWords = onWords
    this.pushStream = SpeechSDK.AudioInputStream.createPushStream(SpeechSDK.AudioStreamFormat.getWaveFormat(
      sampleRate,
      16,
      1,
      SpeechSDK.AudioFormatTag.PCM, //ALAW and MULAW should also work
    ));
    this.recognizer = SpeechSDK.SpeechRecognizer.FromConfig(
      ((token: string, region: string, language: string): SpeechSDK.SpeechConfig => {
        const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(token, region)
        if (!speechConfig) { throw 'error' }

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
    this.recognizer.recognized = this.handler.bind(this)
    this.recognizer.canceled = () => onCancel()

    // API cancels recognizer if dictionary is empty
    if (dictionary.length > 0) {
      SpeechSDK.PhraseListGrammar.fromRecognizer(this.recognizer).addPhrases(dictionary)
    }
  }

  /** Starts the recognition. */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.recognizer.startContinuousRecognitionAsync(() => {
        resolve()
      }, (error) => {
        console.log("[Recognizer] START FAILED:", error)
        reject()
      })
    })
  }

  /** Writes `data` to the recognizer. */
  write(data: ArrayBuffer): void {
    this.pushStream.write(data)
  }

  /** Stops the recognition. */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.recognizer.stopContinuousRecognitionAsync(() => {
        resolve()
      }, (error) => {
        console.log("[Recognizer] STOP FAILED:", error)
        reject()
      })
    })
  }

  /** Handles the results of the recognition. */
  private handler(
    _: SpeechSDK.Recognizer,
    event: SpeechSDK.SpeechRecognitionEventArgs,
  ): void {
    const result = JSON.parse(event.result.json)

    console.log("[Recognizer] language", result.PrimaryLanguage.Language)
    this.onLanguage(result.PrimaryLanguage.Language)

    // MS trim punctuation from Words, kept in Display
    const best: { Words: any[]; Display: string; Confidence: number } = result.NBest[0]
    const splitted = (() => {
      const res: string[] = []
      const splitted = best.Display.split(' ')

      for (let i = 0; i < splitted.length; i++) {
        if (res.length > 0 && !!splitted[i].match(/^[.,:!?]/)) {
          res[res.length - 1] = `${res[res.length - 1]}\xa0${splitted[i]}`
        } else {
          res.push(splitted[i])
        }
      }

      return res
    })()
    const words = best.Words.map((word: any, i: number): RecognizerWord => {
      let value: string
      if (splitted[i] == null || !splitted[i].toLowerCase().startsWith(word.Word.toLowerCase())) {
        value = word.Word
      } else {
        value = splitted[i]
      }

      // MS returns time in 10th of nanos
      const TEN_MILLION = 10_000_000
      return {
        type: 'text',
        value,
        ts: word.Offset / TEN_MILLION,
        end_ts: word.Offset / TEN_MILLION + word.Duration / TEN_MILLION,
        confidence: best.Confidence,
      }
    })

    console.log("[Recognizer] words", words.map((word) => word.value).join(' '))
    this.onWords(words)
  }
}

type RecognizerSessionOptions = {
  token: string
  region: string
  sampleRate: number
  language: string
}

/**
* Allows creation and recreaction of `Recognizer` with buffered inputs and outputs.
*/
export class RecognizerSession {
  private recognizer: Recognizer | null
  private results: RecognizerResults
  private dictionary: string[]
  private buffers: ArrayBuffer[]
  // TODO don't do input buffering here

  /** Returns a new `RecognizerSession`. */
  constructor(dictionary: string[]) {
    this.recognizer = null
    this.results = []
    this.dictionary = dictionary
    this.buffers = []
  }

  /** Returns wether recognizer is started or not. */
  isActive(): boolean {
    return this.recognizer != null
  }

  /** Starts the recognizer. */
  async start({ token, region, language, sampleRate }: RecognizerSessionOptions): Promise<void> {
    if (this.isActive()) throw 'A session is active already'

    this.recognizer = new Recognizer({
      language,
      token,
      region,
      sampleRate,
      dictionary: this.dictionary,
      onLanguage: (language) => this.results.push({ language }),
      onWords: (words) => this.results.push({ words }),
      onCancel: () => console.log("TODO"), // TODO stop and retry to start
    })
    await this.recognizer.start()

    // Flush buffered data
    for (const data of this.buffers.splice(0)) {
      this.write(data)
    }
  }

  /** Writes `data` to the recognizer. */
  write(data: ArrayBuffer): void {
    if (this.isActive()) {
      this.recognizer.write(data)
    } else {
      this.buffers.push(data)
    }
  }

  /** Stops the recognizer. */
  async stop(): Promise<void> {
    if (!this.isActive()) throw 'No active session'

    await this.recognizer.stop()
    this.recognizer = null
  }

  /** Returns the detected languaages and recognized words. */
  getResults(): RecognizerResults {
    return this.results.splice(0)
  }
}
