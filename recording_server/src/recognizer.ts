import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk'
import { RecognizerWord, RecognizerData } from 'spoke_api_js'

/**
* A wrapper around Microsoft's speech SDK: emits lang and words from audio data.
*
* Usage: call `await recognizer.start()`, `recognizer.write(...)`, `await recognizer.stop()` IN THAT ORDER.
*/
export class Recognizer {
  private recognizer: SpeechSDK.SpeechRecognizer
  private pushStream: SpeechSDK.PushAudioInputStream
  private onLanguage: (lang: string) => void
  private onWords: (words: RecognizerWord[]) => void

  constructor({
    lang, token, region, sampleRate, dictionary, onLanguage, onWords
  }: {
    lang: string, token: string, region: string, sampleRate: number, dictionary: string[], onLanguage: (lang: string) => void, onWords: (words: RecognizerWord[]) => void
  }) {
    this.onLanguage = onLanguage
    this.onWords = onWords
    this.pushStream = SpeechSDK.AudioInputStream.createPushStream(SpeechSDK.AudioStreamFormat.getWaveFormat(
      sampleRate,
      16,
      1,
      SpeechSDK.AudioFormatTag.PCM, //ALAW and MULAW should also work
    ));
    this.recognizer = SpeechSDK.SpeechRecognizer.FromConfig(
      ((token: string, region: string, lang: string): SpeechSDK.SpeechConfig => {
        const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(token, region)
        if (!speechConfig) { throw 'error' }

        speechConfig.outputFormat = SpeechSDK.OutputFormat.Detailed
        speechConfig.requestWordLevelTimestamps()
        speechConfig.setProfanity(SpeechSDK.ProfanityOption.Raw)
        speechConfig.speechRecognitionLanguage = lang
        speechConfig.setProperty(
          SpeechSDK.PropertyId.SpeechServiceConnection_LanguageIdMode,
          'Continuous',
        )

        return speechConfig
      })(token, region, lang),
      SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages([
        'en-US',
        'fr-FR',
        'es-ES',
        lang,
      ]),
      SpeechSDK.AudioConfig.fromStreamInput(this.pushStream),
    )
    this.recognizer.recognized = this.handler.bind(this)
    SpeechSDK.PhraseListGrammar.fromRecognizer(this.recognizer).addPhrases(dictionary)
  }

  async start(): Promise<void> {
    console.log("[Recognizer] STARTING")
    return new Promise((resolve, reject) => {
      this.recognizer.startContinuousRecognitionAsync(() => {
        console.log("[Recognizer] STARTED")
        resolve()
      }, (error) => {
        console.log("[Recognizer] START FAILED:", error)
        reject()
      })
    })
  }

  write(data: ArrayBuffer): void {
    this.pushStream.write(data)
  }

  async stop(): Promise<void> {
    console.log("[Recognizer] STOPPING")
    return new Promise((resolve, reject) => {
      this.recognizer.stopContinuousRecognitionAsync(() => {
        console.log("[Recognizer] STOPPED")
        resolve()
      }, (error) => {
        console.log("[Recognizer] STOP FAILED:", error)
        reject()
      })
    })
  }

  private handler(
    _: SpeechSDK.Recognizer,
    event: SpeechSDK.SpeechRecognitionEventArgs,
  ): void {
    const result = JSON.parse(event.result.json)

    console.log("[Recognizer] lang", result.PrimaryLanguage.Language)
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

export class RecognizerSession {
  private recognizer: Recognizer | null
  private data: RecognizerData
  private dictionary: string[]

  constructor(dictionary: string[]) {
    this.recognizer = null
    this.data = []
    this.dictionary = dictionary
  }

  isActive(): boolean {
    return this.recognizer != null
  }

  async start({ lang, token, region, sampleRate }: { lang: string, token: string, region: string, sampleRate: number }): Promise<void> {
    if (this.isActive()) throw 'A session is active already'

    this.recognizer = new Recognizer({
      lang,
      token,
      region,
      sampleRate,
      dictionary: this.dictionary,
      onLanguage: (lang) => { this.data.push({ lang }) },
      onWords: (words) => { this.data.push({ words }) },
    })
    await this.recognizer.start()
  }

  write(data: ArrayBuffer): void {
    if (!this.isActive()) throw 'No active session'

    this.recognizer.write(data)
  }

  async stop(): Promise<void> {
    if (!this.isActive()) return

    await this.recognizer.stop()
    this.recognizer = null
  }

  flush(): RecognizerData {
    return this.data.splice(0)
  }
}
