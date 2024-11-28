import { RecordingMode, SpeakerData } from '../observeSpeakers'

import { sleep } from '../api'

export const SPEAKER_LATENCY = 1500 // ms

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
        console.error('[Teams] Failed to observe Teams meeting', e)
    }
}

function getDocumentRoot(): Document {
    for (let iframe of document.querySelectorAll('iframe')) {
        try {
            const doc = iframe.contentDocument || iframe.contentWindow?.document
            if (doc) {
                console.log('[Teams] Document root found in iframe')
                return doc
            }
        } catch (e) {
            console.warn('[Teams] Error accessing iframe content', e)
        }
    }
    console.log('[Teams] Using main document as root')
    return document
}

export function getSpeakerFromDocument(
    recordingMode: RecordingMode,
    timestamp: number,
    bot_name: string,
): SpeakerData[] {
    // console.log('[Teams] Starting getSpeakerFromDocument', {
    //     recordingMode,
    // })
    const documentRoot = getDocumentRoot()
    const speakerElements = documentRoot.querySelectorAll(
        '[data-cid="calling-participant-stream"]',
    )
    // console.log('[Teams] Found speaker elements:', speakerElements.length)
    const speakers = Array.from(speakerElements)
        .map((element) => {
            // can create errors if speaker has a "," in his name
            const name = getParticipantName(element)
            if (name !== '') {
                if (element.getAttribute('aria-label')?.includes(', muted,')) {
                    // muted speakers can not be speaking, this is a security
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
        })
        .filter((value) => value !== undefined) as SpeakerData[]

    removeShityHtml(recordingMode)

    // Add the bot speaker.
    speakers.push({
        name: bot_name,
        id: 0,
        timestamp,
        isSpeaking: false,
    } as SpeakerData)
    console.table(speakers)
    return speakers
}

function checkIfSpeaking(element: HTMLElement): boolean {
    let isSpeaking = checkElementAndPseudo(element)
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
    const afterStyle = window.getComputedStyle(el, '::after')

    if (el.getAttribute('data-tid') === 'participant-speaker-ring') {
        console.log('participant-speaker-ring', parseFloat(style.opacity) === 1)
        return parseFloat(style.opacity) === 1
    }
    console.log(
        'isBlueish(style.borderColor)',
        isBlueish(style.borderColor) ||
            isBlueish(beforeStyle.borderColor) ||
            isBlueish(afterStyle.borderColor),
        'style :',
        style.borderColor,
        'beforeStyle :',
        beforeStyle.borderColor,
        'afterStyle :',
        afterStyle.borderColor,
    )
    return (
        (isBlueish(style.borderColor) && parseFloat(style.opacity) === 1) ||
        (isBlueish(beforeStyle.borderColor) &&
            parseFloat(beforeStyle.opacity) === 1) ||
        (isBlueish(afterStyle.borderColor) &&
            parseFloat(afterStyle.opacity) === 1)
    )
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
    const nameBlackList: string[] = ['Content shared by', 'Leaving...']
    const toSplitOn: string[] = [
        ', video is on,',
        ', muted,',
        ', Context menu is available',
        '(Unverified)',
        'left the meeting',
        'Leaving...',
    ]

    const ariaLabel = name.getAttribute('aria-label') || ''
    let result: string = ariaLabel

    // Vérifie si le label contient des éléments de la blacklist
    for (const blackListed of nameBlackList) {
        if (ariaLabel.includes(blackListed)) {
            return '' // Retourne une chaîne vide si un élément blacklisté est trouvé
        }
    }

    // Divise le label basé sur les motifs spécifiés et garde la première partie
    for (const splitTerm of toSplitOn) {
        result = result.split(splitTerm)[0]
    }

    return result // Retourne le résultat final après toutes les divisions
}

export function findAllAttendees(): string[] {
    // console.log('[Teams] Starting findAllAttendees')
    const documentRoot = getDocumentRoot()
    const attendeeElements = documentRoot.querySelectorAll(
        '[data-cid="calling-participant-stream"]',
    )
    // get attendees, do not take into account empty attendees
    const attendees = Array.from(attendeeElements)
        .map((el) => getParticipantName(el))
        .filter(Boolean)
    // console.log('[Teams] Found attendees:', attendees)
    return attendees
}

export async function removeInitialShityHtml(mode: RecordingMode) {
    // console.log('[Teams] Starting removeInitialShityHtml', { mode })
    await sleep(1000)
    const documentRoot = getDocumentRoot()
    try {
        const meetingControls = documentRoot.querySelectorAll(
            `div[data-tid="app-layout-area--header"]`,
        )

        if (meetingControls[0] instanceof HTMLElement) {
            meetingControls[0].style.opacity = '0'
            // console.log('[Teams] Meeting controls hidden')
        }
    } catch (e) {
        // console.error('[Teams] Failed to remove buttons header', e)
    }

    try {
        const style = documentRoot.createElement('style')
        documentRoot.head.appendChild(style)
        const sheet = style.sheet

        sheet?.insertRule(
            `
        [data-tid="voice-level-stream-outline"]::before {
          border: 0px solid rgb(127, 133, 245);
        }
      `,
            sheet.cssRules.length,
        )
        // console.log('[Teams] Voice level stream outline style added')
    } catch (e) {
        // console.error('[Teams] Error in insert before style', e)
    }
}

export function removeShityHtml(mode: RecordingMode) {
    // console.log('[Teams] Starting removeShityHtml', { mode })
    const documentRoot = getDocumentRoot()
    try {
        const menus = documentRoot.querySelectorAll('[role="menu"]')
        const menu = menus[0] || menus
        if (menu instanceof HTMLElement) {
            menu.style.position = 'fixed'
            menu.style.top = '0'
            menu.style.left = '0'
            menu.style.width = '100vw'
            menu.style.height = '100vh'
            menu.style.zIndex = '9999'
            menu.style.backgroundColor = 'black'
            console.log('[Teams] Menu element hidden')
        }
    } catch (e) {
        // console.error('[Teams] Error in remove shitty html', e)
    }

    try {
        let hiddenDivs = 0
        documentRoot.querySelectorAll('div').forEach((div) => {
            if (div.clientHeight === 137 && div.clientWidth === 245) {
                div.style.opacity = '0'
                hiddenDivs++
            }
        })
        // console.log('Teams] Hidden', hiddenDivs, 'additional elements')
    } catch (e) {
        // console.error('[Teams] Error in remove additional elements', e)
    }
}
