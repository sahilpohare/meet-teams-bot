import * as R from 'ramda'
import { Speaker } from './observeSpeakers'
import { SESSION, START_RECORD_TIMESTAMP, SpokeSession } from './record'
import {
    Asset,
    Editor,
    EditorWrapper,
    Transcript,
    Video,
    api,
} from './spoke_api_js'
import { parameters } from './state'

export async function uploadEditorsTask(speakers: Speaker[]) {
    let intervals = timestampToInterval(speakers)
    intervals.pop()
    const spokeSession = SESSION as SpokeSession
    if (intervals.length > spokeSession.completeEditors.length) {
        let interval = intervals[intervals.length - 1]
        if (spokeSession.project.complete_preview_path == null) {
            try {
                const preview = await api.generatePreview(SESSION!.id)
                spokeSession.project.complete_preview_path = preview.s3_path
                await api.patchProject({
                    id: spokeSession.project.id,
                    complete_preview_path: preview.s3_path,
                })
            } catch (e) {
                console.error('error generating preview: ', e)
            }
        }
        if (spokeSession.thumbnailPath == null) {
            console.log(`[resuming] extract audio and image`)
            try {
                const extract = await api.extractImage(0, 1, SESSION!.id)
                spokeSession.thumbnailPath = extract.image_s3_path
            } catch (e) {
                console.error('error extracting image: ', e)
            }
        }

        console.log(`[resuming] uploadCompleteEditor`, interval)
        try {
            const postableCompleteEditor = createEditorWrapper(
                interval,
                spokeSession.project.id,
                spokeSession.asset,
            )
            const completeEditor = await api.postCompleteEditor(
                postableCompleteEditor,
            )
            insertIntoSortedArrayInPlace(
                spokeSession.completeEditors,
                R.clone(completeEditor),
            )
        } catch (e) {
            console.error('[uploadEditorTasks] error posting editor', e)
        }
    }
}
const insertIntoSortedArrayInPlace = (arr: EditorWrapper[], value) => {
    // Find the correct index using a binary search-like approach
    const index =
        R.findIndex(
            (item) => value.audio_offset < item.video.audio_offset,
            arr,
        ) - 1

    // If index is -1, the value is greater than all elements in the array, so push it at the end
    // Otherwise, splice the array to insert the value at the found index, modifying the original array
    if (index < 0) {
        arr.push(value)
    } else {
        arr.splice(index, 0, value)
    }

    // No return needed since the operation is in-place
}

function createEditorWrapper(
    speaker: SpeakerInterval,
    projectId: number,
    asset: Asset,
): EditorWrapper {
    return {
        editor: createEditor(speaker, projectId) as Editor,
        video: createVideo(speaker, asset) as Video,
    }
}

function createEditor(
    speaker: SpeakerInterval,
    projectId: number,
): Partial<Editor> {
    return {
        index: 0,
        project_id: projectId,
        clipitems: [],
    } as Partial<Editor>
}

function createVideo(speaker: SpeakerInterval, asset: Asset): Partial<Video> {
    return {
        s3_path: SESSION?.videoS3Path,
        transcripts: createTranscripts(speaker) as Transcript[],
        thumbnail_path: SESSION?.thumbnailPath,
        duration: speaker.end_time / 1000 - speaker.start_time / 1000,
        width: 0,
        height: 0,
        audio_offset: speaker.start_time / 1000,
        asset_id: asset.id,
        transcription_completed: true,
    }
}

function createTranscripts(speaker: SpeakerInterval): Partial<Transcript>[] {
    const transcripts = [
        {
            speaker: speaker.speaker,
            words: [],
            google_lang: parameters.detected_lang ?? parameters.language,
        },
    ]
    return transcripts
}

type SpeakerInterval = {
    start_time: number
    end_time: number
    speaker: string
}

function timestampToInterval(speakers: Speaker[]): SpeakerInterval[] {
    const intervals = speakers.map((speaker, index) => {
        // For the last speaker, we might want to set a specific end timestamp.
        // Here, we're simply using the next hour as an example.
        const endTimestamp =
            index < speakers.length - 1
                ? speakers[index + 1].timestamp
                : speaker.timestamp + 3600000

        return {
            start_time: speaker.timestamp - START_RECORD_TIMESTAMP,
            end_time: endTimestamp - START_RECORD_TIMESTAMP,
            speaker: speaker.name,
        }
    })

    return intervals
}
