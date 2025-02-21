import { RecordingMode, SpeakerData } from '../observeSpeakers'

export const SPEAKER_LATENCY = 1500 // ms

// DANS LA NOUVELLE INTERFACE:
// data-class-name-list="bkg_MymaBCIcQp8Wp0Fbot,bkg_PhilippeDrion,bkg_AragornUnverified," => y en a qu'un seul

export async function getSpeakerRootToObserve(
    _recordingMode: RecordingMode,
): Promise<[Node, MutationObserverInit] | undefined> {
    try {
        return [
            getDocumentRoot(),
            {
                attributes: true,
                childList: true,
                subtree: true,
                attributeFilter: ['style', 'class'],
            },
        ]
    } catch (e) {
        // console.error('[Teams] Failed to observe Teams meeting', e)
    }
}

function getDocumentRoot(): Document {
    for (let iframe of document.querySelectorAll('iframe')) {
        try {
            const doc = iframe.contentDocument || iframe.contentWindow?.document
            if (doc) {
                // console.log('[Teams] Document root found in iframe')
                return doc
            }
        } catch (e) {
            // console.warn('[Teams] Error accessing iframe content', e)
        }
    }
    // console.log('[Teams] Using main document as root')
    return document
}

export function getSpeakerFromDocument(
    _recordingMode: RecordingMode,
    timestamp: number,
): SpeakerData[] {
    const documentRoot = getDocumentRoot()

    // old and new teams
    const oldInterfaceElements = documentRoot.querySelectorAll(
        '[data-cid="calling-participant-stream"]',
    )
    const newInterfaceElements = documentRoot.querySelectorAll(
        '[data-stream-type="Video"]',
    )
    // new teams live
    const liveElements = documentRoot.querySelectorAll('[data-tid="menur1j"]')

    // use the interface with participants
    const speakerElements =
        oldInterfaceElements.length > 0
            ? oldInterfaceElements
            : newInterfaceElements.length > 0
            ? newInterfaceElements
            : liveElements

    const speakers = Array.from(speakerElements)
        .map((element) => {
            if (element.hasAttribute('data-cid')) {
                // old teams
                const name = getParticipantName(element)
                if (name !== '') {
                    if (
                        element.getAttribute('aria-label')?.includes(', muted,')
                    ) {
                        return {
                            name,
                            id: 0,
                            timestamp,
                            isSpeaking: false,
                        }
                    } else {
                        return {
                            name,
                            id: 0,
                            timestamp,
                            isSpeaking: checkIfSpeaking(element as HTMLElement),
                        }
                    }
                }
            } else if (
                element.hasAttribute('data-tid') &&
                element.getAttribute('data-tid') === 'menur1j'
            ) {
                //live platform: Handle live platform
                const name =
                    element.getAttribute('aria-label')?.split(',')[0] || ''
                const micIcon = element.querySelector(
                    '[data-cid="roster-participant-muted"]',
                )
                const isMuted = micIcon ? true : false
                const voiceLevelIndicator = element.querySelector(
                    '[data-tid="voice-level-stream-outline"]',
                )
                const isSpeaking =
                    !isMuted && voiceLevelIndicator
                        ? checkElementAndPseudo(
                              voiceLevelIndicator as HTMLElement,
                          )
                        : false

                return {
                    name,
                    id: 0,
                    timestamp,
                    isSpeaking,
                }
            } else {
                // new teams
                const name = element.getAttribute('data-tid')
                if (name) {
                    const micPath = element.querySelector(
                        'g.ui-icon__outline path',
                    )
                    const isMuted =
                        micPath?.getAttribute('d')?.startsWith('M12 5v4.879') ||
                        false
                    const voiceLevelIndicator = element.querySelector(
                        '[data-tid="voice-level-stream-outline"]',
                    )
                    const isSpeaking =
                        voiceLevelIndicator && !isMuted
                            ? checkElementAndPseudo(
                                  voiceLevelIndicator as HTMLElement,
                              )
                            : false

                    return {
                        name,
                        id: 0,
                        timestamp,
                        isSpeaking,
                    }
                }
            }
        })
        .filter((value) => value !== undefined) as SpeakerData[]
    // console.table(speakers)
    return speakers
}

function checkIfSpeaking(element: HTMLElement): boolean {
    let isSpeaking: boolean = checkElementAndPseudo(element)
    if (!isSpeaking) {
        element.querySelectorAll('*').forEach((child) => {
            if (checkElementAndPseudo(child as HTMLElement)) {
                isSpeaking = true
            }
        })
    }
    return isSpeaking
}

function checkElementAndPseudo(el: HTMLElement): boolean {
    const style = window.getComputedStyle(el)
    const beforeStyle = window.getComputedStyle(el, '::before')
    // const afterStyle = window.getComputedStyle(el, '::after')
    const borderStyle = window.getComputedStyle(el)

    // Old teams
    if (el.getAttribute('data-tid') === 'participant-speaker-ring') {
        return parseFloat(style.opacity) === 1
    }

    // New teams
    if (
        el.getAttribute('data-tid') === 'voice-level-stream-outline' &&
        el.closest('[data-stream-type="Video"]')
    ) {
        const hasVdiFrameClass = el.classList.contains('vdi-frame-occlusion')
        const borderColor =
            beforeStyle.borderColor || beforeStyle.borderTopColor
        const borderOpacity = parseFloat(beforeStyle.opacity)
        return (
            hasVdiFrameClass || (isBlueish(borderColor) && borderOpacity === 1)
        )
    }

    // Live platform
    if (
        el.getAttribute('data-tid') === 'voice-level-stream-outline' &&
        window.location.href.includes('live')
    ) {
        const hasVdiFrameClass = el.classList.contains('vdi-frame-occlusion')
        const borderOpacity =
            parseFloat(beforeStyle.opacity) || parseFloat(borderStyle.opacity)
        const borderColor =
            beforeStyle.borderColor ||
            beforeStyle.borderTopColor ||
            borderStyle.borderColor
        return (
            hasVdiFrameClass || (isBlueish(borderColor) && borderOpacity === 1)
        )
    }

    return false
}

function isBlueish(color: string): boolean {
    // Normalize the color string
    color = color.toLowerCase().trim()

    let rgb: number[] | null = null // Initialize to null

    // Check and extract RGB values from hex format
    if (color.startsWith('#')) {
        // Handle short hex format (e.g., #fff)
        if (color.length === 4) {
            const r = parseInt(color[1] + color[1], 16)
            const g = parseInt(color[2] + color[2], 16)
            const b = parseInt(color[3] + color[3], 16)
            rgb = [r, g, b]
        }
        // Handle long hex format (e.g., #ffffff)
        else if (color.length === 7) {
            const r = parseInt(color.slice(1, 3), 16)
            const g = parseInt(color.slice(3, 5), 16)
            const b = parseInt(color.slice(5, 7), 16)
            rgb = [r, g, b]
        }
    } else {
        // Try to extract RGB values from "rgb" or "rgba" format
        const match = color.match(/\d+/g)
        if (match && match.length >= 3) {
            rgb = match.map(Number).slice(0, 3) // Ensure only the first three numbers are used
        }
    }

    // Check if rgb is assigned and validate the blue dominance with stricter criteria
    if (rgb && rgb.length === 3) {
        const [r, g, b] = rgb
        return b > 180 && b > r + 40 && b > g + 40 && r < 150 && g < 150
    }
    return false
}

function getParticipantName(name: Element): string {
    const nameBlackList = ['Content shared by', 'Leaving...']
    const toSplitOn = [
        ', video is on,',
        ', muted,',
        ', Context menu is available',
        '(Unverified)',
        'left the meeting',
        'Leaving...',
    ]

    const ariaLabel = name.getAttribute('aria-label') || ''
    let result: string = ariaLabel

    for (const blackListed of nameBlackList) {
        if (ariaLabel.includes(blackListed)) {
            return ''
        }
    }

    for (const splitTerm of toSplitOn) {
        result = result.split(splitTerm)[0]
    }

    return result
}

export function findAllAttendees(): string[] {
    // old and new teams
    const oldInterfaceContainers = document.querySelectorAll(
        '[data-cid="calling-participant-stream"]',
    )
    const newInterfaceContainers = document.querySelectorAll(
        '[data-stream-type="Video"]',
    )

    // use the interface with participants
    const participantContainers =
        oldInterfaceContainers.length > 0
            ? oldInterfaceContainers
            : newInterfaceContainers

    // get the names
    const attendees = Array.from(participantContainers)
        .map((el) => {
            if (el.hasAttribute('data-cid')) {
                // old teams
                return getParticipantName(el)
            } else {
                // new teams
                return el.getAttribute('data-tid') || ''
            }
        })
        .filter(Boolean) // filter empty values

    return attendees
}
