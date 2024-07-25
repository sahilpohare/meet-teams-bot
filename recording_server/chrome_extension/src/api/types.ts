export type Project = {
    id: number
    creator_id: number
    name: string
    duration: number
    editors: EditorWrapper[]
    created_at: {
        secs_since_epoch: number
    }
    updated_at: {
        secs_since_epoch: number
    }
    is_new_project: boolean
    share_link: string
    final_zip_path: string | null
    final_video_url?: string
    view_counter: number
    assets: Asset[]
    clipitems: Clipitem[]
    labels: Label[]
    categories: Category[]
    delete_marker: boolean
    workspace_id: number
    new_spoke: NewSpoke
    is_workspace_member: boolean
    template: AgendaJson
    summary: string
    summary_length_written: number
    creator_email?: string
    last_updater_email?: string
    is_synced: boolean
    complete_preview_path?: string
    moment_pending?: number
    no_transcript?: boolean
    original_agenda_id?: number
    original_agenda_name?: string
    attendees?: Attendee[]
    client_name?: string
}
export type Attendee = {
    name: String
}
export type Template = {
    id: number
    project_id: number | null
    json: TemplateSkeleton
}
export type TemplateSkeleton = {
    blocks: Block[]
}
export type Block = {
    type: string
    data: Data
}
export type Data = {
    id: number | null
    text?: string
}
export type NewSpoke = {
    id: number
    account_id: number
    project_id: number
}
export type Asset = {
    id: number
    name: string
    s3_path: string
    s3_url: string
    created_at: {
        secs_since_epoch: number
    }
    moment_pending: number
    human_transcription_pending: number
    uploading: boolean
    from_app: boolean
    is_meeting_bot: boolean
    duration?: number
    upload_error?: string
    project_id?: number
}
export type CompleteAsset = {
    id: number
    name: string
    created_at: {
        secs_since_epoch: number
    }
    videos: Video[]
    duration: number
}
export type EditorWrapper = {
    editor: Editor
    video: Video
}
export type Editor = {
    id: number
    index: number
    project_id: number
    original_project_id?: number
    video_id: number
    final_moment_path: string
    final_moment_status: string
    watch_all_start_time: number
    watch_all_end_time: number
}
export type Video = {
    id: number
    uid: number
    s3_path: string
    uploader_id: number
    width: number
    height: number
    sound_url?: string
    transcripts: Transcript[]
    thumbnail_path: string
    soundcard_path?: string
    microphone_path?: string
    thumbnail_url: string
    duration: number
    audio_offset: number
    transcription_validated: boolean
    asset_id: number
    transcription_completed: boolean
}
export type Word = {
    id: number
    text?: string
    start_time: number
    end_time: number
    transcript_id: number
    is_temporary: boolean
}
export type Transcript = {
    id: number
    speaker: string
    video_id: number
    last_modified_by_id: number
    words: Word[]
    original_words: Word[]
    google_lang: string
    matching?: string
}
export type Caption = {
    in_time: number
    out_time: number
    start_time: number
    end_time: number
}
export type Clipitem = {
    id: number
    in_time: number
    out_time: number
    asset_id: number
    project_id: number
    labels: Label[]
    summary?: String
}
export type Label = {
    id: number
    name: string
    color: string
    account_id: number
}
export type Category = {
    id: number
    name: string
    color: string
}

export type Agenda = {
    id: number
    name: string
    project_id?: number
    is_template: boolean
    json: AgendaJson
    creator_id: number
    workspace_id: number
    created_at: { secs_since_epoch: number }
    updated_at: { secs_since_epoch: number }
    share_link: string
    creator_email?: string
    last_updater_email: string
}

export type TemplateSummaries = {
    templates: Agenda[]
    has_more_data: boolean
}

export type AgendaJson = {
    blocks: AgendaBlock[]
}

export type AgendaBlock =
    | TalkingPointEditorJs
    | HeaderEditorJs
    | ParagraphEditorJs

export type TalkingPointEditorJs = {
    type: 'talkingpoint'
    id: string
    data: TalkingPointData
}
export type TalkingPointData = {
    name: string
    label?: Label
    noLabel?: boolean
}

export type HeaderEditorJs = {
    type: 'header'
    id: string
    data: {
        text: string
    }
}

export type ParagraphEditorJs = {
    type: 'paragraph'
    id: string
    data: {
        text: string
    }
}

export type MeetingProvider = 'Zoom' | 'Meet' | 'Teams'

export interface RunPodResult {
    detected_language: string
    word_timestamps: RunPodWordTimestamp[]
}
export interface RunPodWordTimestamp {
    start: number
    end: number
    word: string
}
/** Output word of the `Recognizer`. */
export type RecognizerWord = {
    /** The type. */
    type: string
    /** The word recognized. */
    value: string
    /** Start timestamp (in seconds). */
    ts: number /** End timestamp (in seconds). */
    end_ts: number
    /** Confidence ([0.0, 1.0]). */
    confidence: number
}
/** Output data of the `RecognizerSession`. */
export type RecognizerResult = {
    /** Time offset. */
    offset: number
    /** API's `result.json`. */
    json: string
}

export type DetectTemplateResponse = {
    meeting_template: string
    justification?: string
}
export type DetectClientResponse = {
    client_names: string[]
}

export interface RunPodTranscriptionStatus {
    id: string
    status: string
    output?: RunPodResult
}

export type Workspace = {
    id: number
    name: string
    personal: boolean
    members: WorkspaceToAccount[]
    notifications: Notification[]
    member_invite_token: string
    admin_invite_token: string
    payer_id: number
}

export type WorkspaceRole = 'Member' | 'Admin'

export type Notification = {
    id: number
    account_id: number
    workspace_id: number
    category_id?: number
    project_id: number
}

export type WorkspaceToAccount = {
    id: number
    email: string
    account_id: number
    workspace_role: WorkspaceRole
    has_connected_calendar: boolean
    firstname?: string
    lastname?: string
    project_count: number
}

export const LABEL_COLORS = [
    '#91BB54',
    '#BF6E32',
    '#3AA056',
    '#008574',
    '#E66596',
    '#388ED2',
    '#D44A66',
    '#70538B',
    '#33539F',
    '#FF8978',
    '#9D59A7',
    '#A94D85',
    '#1DB7C1',
    '#7571C0',
    '#00A5D0',
    '#E46135',
    '#98B223',
    '#006775',
    '#A63163',
]

export type SummaryParam = {
    sentences: Sentence[]
    max_token?: number
    labels?: string[]
    lang?: string
    project_id?: number
    title?: string
    participants?: string[]
    test_prompt?: string
    test_model?: string
    test_gpt4?: boolean
    client_name?: string
    template_name?: string
    highlights_without_timestamp?: string[]
}

export type Sentence = {
    speaker: string
    start_timestamp?: number
    end_timestamp?: number
    words: WordSummary[]
}

type WordSummary = {
    text: string
}
