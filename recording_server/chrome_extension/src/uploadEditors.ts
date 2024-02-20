import * as R from 'ramda'
import {
    Asset,
    Editor,
    EditorWrapper,
    Transcript,
    Video,
    Word,
    api,
} from 'spoke_api_js'
import { TranscriptWithSpeaker } from './Transcribe/addSpeakerNames'
import { SESSION, SpokeSession } from './record'
import { parameters } from './state'

export async function uploadEditorsTask(transcript: TranscriptWithSpeaker) {
    const spokeSession = SESSION as SpokeSession
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

    console.log(`[resuming] uploadCompleteEditor`, transcript)
    try {
        const postableCompleteEditor = createEditorWrapper(
            transcript,
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
    videoInfo: TranscriptWithSpeaker,
    projectId: number,
    asset: Asset,
): EditorWrapper {
    return {
        editor: createEditor(videoInfo, projectId) as Editor,
        video: createVideo(videoInfo, asset) as Video,
    }
}

function createEditor(
    transcript: TranscriptWithSpeaker,
    projectId: number,
): Partial<Editor> {
    return {
        index: 0,
        project_id: projectId,
        clipitems: [],
    } as Partial<Editor>
}

function createVideo(
    transcript: TranscriptWithSpeaker,
    asset: Asset,
): Partial<Video> {
    return {
        s3_path: SESSION?.videoS3Path,
        transcripts: createTranscripts(transcript) as Transcript[],
        thumbnail_path: SESSION?.thumbnailPath,
        duration: transcript.endTime - transcript.startTime,
        width: 0,
        height: 0,
        audio_offset: transcript.startTime,
        asset_id: asset.id,
        transcription_completed: true,
    }
}

function createTranscripts(
    transcript: TranscriptWithSpeaker,
): Partial<Transcript>[] {
    const transcripts = [
        {
            speaker: transcript.speaker,
            words: transcript.words.map((w) => ({
                text: w.value,
                start_time: w.ts,
                end_time: w.end_ts,
                is_temporary: false,
            })) as Word[],
            google_lang: parameters.language,
        },
    ]
    return transcripts
}
