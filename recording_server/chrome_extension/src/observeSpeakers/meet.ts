import { RecordingMode, Speaker } from '../observeSpeakers'

import { sleep } from '../utils'

export const MIN_SPEAKER_DURATION = 200
export const SPEAKER_LATENCY = 500
const processedElements = new Set<HTMLElement>()
let videoElement: HTMLVideoElement | null = null
let videoContainer: HTMLElement | null = null

export async function getSpeakerRootToObserve(
    mutationObserver: MutationObserver,
    recordingMode: RecordingMode,
) {
    let root: any = null

    // Set interval to log and reset speaker counts every 100 ms
    setInterval(calcSpeaker, 100)
    if (recordingMode === 'gallery_view') {
        mutationObserver.observe(document, {
            attributes: true,
            characterData: true,
            childList: true,
            subtree: true,
            attributeFilter: ['class'],
        })
    } else {
        while (root == null) {
            root = (Array as any)
                .from(document.querySelectorAll('div'))
                .find((d) => d.innerText === 'People')
                ?.parentElement?.parentElement
            if (root != null) {
                try {
                    root.parentElement.style.opacity = 0
                    root.parentElement.parentElement.style.opacity = 0
                    const rootLeft = (Array as any)
                        .from(document.querySelectorAll('div'))
                        .find((d) => d.innerText === 'You')
                    rootLeft.parentElement.parentElement.parentElement.parentElement.style.width =
                        '97vw'
                } catch (e) {
                    console.error(
                        '[getSpeakerRootToObserve] on meet error finding You',
                        e,
                    )
                }

                try {
                    // Find all div elements
                    const allDivs = document.querySelectorAll('div')

                    // Filter divs to include padding in their size (assuming border-box sizing)
                    const filteredDivs = Array.from(allDivs).filter((div) => {
                        // Use offsetWidth and offsetHeight to include padding (and border)
                        const width = div.offsetWidth
                        const height = div.offsetHeight

                        return (
                            width === 360 &&
                            (height === 64 ||
                                height === 63 ||
                                height === 50.99 ||
                                height === 51 ||
                                height === 66.63)
                        )
                    })

                    // Log the filtered divs
                    console.log(filteredDivs)

                    // Example action: outline the filtered divs
                    filteredDivs.forEach((div) => {
                        div.remove()
                    })
                } catch (e) {
                    console.error(
                        '[getSpeakerRootToObserve] on meet error removing useless divs',
                        e,
                    )
                }

                mutationObserver.observe(root, {
                    attributes: true,
                    characterData: true,
                    childList: true,
                    subtree: true,
                    attributeFilter: ['class'],
                })
            } else {
                console.error('could not find root speaker to observe')
            }
            await sleep(1000)
        }
    }
}

// Function to reset speaker counts
function resetSpeakerCounts() {
    speakerCounts = new Map()
}

// Function to log speaker counts
function calcSpeaker() {
    let maxCount = 0
    let maxSpeaker = ''

    // Find the speaker with the maximum occurrences
    speakerCounts.forEach((count, speaker) => {
        if (count > maxCount) {
            maxSpeaker = speaker
            maxCount = count
        }
    })

    // let stringified = ''
    // speakerCounts.forEach((count, speaker) => {
    //     stringified += `${speaker}: ${count}, `
    // })

    // chrome.runtime.sendMessage({
    //     type: 'LOG_FROM_SCRIPT',
    //     payload: { log: stringified, timestamp: Date.now() },
    // })
    // Only add to array if a speaker was found
    if (maxSpeaker) {
        const currentDate = Date.now()
        maxOccurrences.push({
            speaker: maxSpeaker,
            timestamp: currentDate,
            count: maxCount,
        })
    }
    resetSpeakerCounts()
}

// Array to store the maximum occurrences of a speaker in a 100 ms interval
let maxOccurrences: { speaker: string; timestamp: number; count: number }[] = []

// Array to store current speaker count in this 100 ms interval
let speakerCounts = new Map()

export function getSpeakerFromDocument(
    currentSpeaker: string | null,
    mutation: MutationRecord | null,
    recordingMode: RecordingMode,
): Speaker[] {
    const speaker = getSpeakerFromMutation(mutation, recordingMode)
    if (speaker != null) {
        speakerCounts.set(speaker, (speakerCounts.get(speaker) || 0) + 1)
    }

    // Check for more than 3 adjacent occurrences of a different speaker
    for (let i = 0; i < maxOccurrences.length; i++) {
        if (maxOccurrences[i].speaker !== currentSpeaker) {
            let differentSpeaker = maxOccurrences[i]
            let differentSpeakerCount = 0
            for (let j = i; j < maxOccurrences.length; j++) {
                if (maxOccurrences[j].speaker === differentSpeaker.speaker) {
                    if (differentSpeakerCount >= 4) {
                        maxOccurrences = maxOccurrences.slice(j)
                        return [
                            {
                                name: differentSpeaker.speaker,
                                timestamp: differentSpeaker.timestamp,
                                isSpeaking: true,
                            },
                        ]
                    }
                    differentSpeakerCount++
                } else {
                    break
                }
            }
        }
    }
    if (maxOccurrences.length > 0) {
        if (
            maxOccurrences[maxOccurrences.length - 1].speaker === currentSpeaker
        ) {
            maxOccurrences = maxOccurrences.slice(-1)
        }
    }
    return []
}

export function getSpeakerFromMutation(
    mutation: MutationRecord | null,
    recordingMode: RecordingMode,
): string | null {
    if (mutation == null) {
        return null
    }
    try {
        const target = mutation.target as Element
        let color = getComputedStyle(target).backgroundColor

        if (color !== 'rgba(26, 115, 232, 0.9)') {
            return null
        }
        // console.log({ color })
        let styleBar = getComputedStyle(target.children[1])
        const height = styleBar.height
        // console.log(height)

        // when speaker is not speaking, height is 4px
        if (height == '4px') {
            return null
        }

        if (recordingMode === 'gallery_view') {
            const foundElement = findSelfNameRecursive(target)
            return extractTooltipText(foundElement!)
        } else {
            let speakers: string[] = []
            const divButton = target.parentElement!.parentElement!.parentElement
            if (divButton && divButton.nodeName === 'BUTTON') {
                const divSpeaker =
                    divButton!.parentElement!.parentElement!.parentElement!
                        .parentElement!.parentElement!.parentElement
                const speakerName = divSpeaker && findSpeakerName(divSpeaker)
                if (speakerName) {
                    return speakerName
                } else {
                    const divSpeaker =
                        divButton!.parentElement!.parentElement!.parentElement!
                            .parentElement
                    const speakerName =
                        divSpeaker && findSpeakerName(divSpeaker)
                    if (speakerName) {
                        return speakerName
                    } else {
                        console.error('no div speaker button', { mutation })
                    }
                }
            } else {
                const divSpeaker =
                    target!.parentElement!.parentElement!.parentElement!
                        .parentElement
                if (divSpeaker) {
                    const speakerName = findSpeakerName(divSpeaker)
                    if (speakerName) {
                        return speakerName
                    } else {
                        console.error('no div speaker', { mutation })
                    }
                } else {
                    console.error('no div speaker', { mutation })
                }
            }
        }
        // })
        return null
    } catch (e) {
        console.error('error in getSpeakerFromMutation', e)
        return null
    }
}

function findSpeakerName(divSpeaker: any) {
    // Array.from(divSpeaker.querySelectorAll('span')).forEach(s => console.log(s.innerText))
    // console.log({ mutation })
    // console.log('BUTTON: ', { divSpeaker })
    try {
        // const q = divSpeaker.childNodes[0]
        // const w = divSpeaker.childNodes[0].childNodes[1]
        // const e = divSpeaker.childNodes[0].childNodes[1].childNodes[0]
        const span =
            divSpeaker.childNodes[0].childNodes[1].childNodes[0].childNodes[0]
        // console.log(q)
        // console.log(w)
        // console.log(e)
        // console.log(span)
        if (
            span &&
            span.nodeName === 'SPAN' &&
            span.innerText != null &&
            span.innerText !== ''
        ) {
            return span.innerText
            // console.log(span.innerText)
        }
    } catch (e) {
        return null
    }
    return null
}

export async function removeInitialShityHtml(
    mode: RecordingMode,
): Promise<void> {
    try {
        videoElement = document.getElementsByTagName(
            'video',
        )[0] as HTMLVideoElement
        videoContainer = videoElement?.closest('div') as HTMLElement

        function processElement(element: HTMLElement) {
            if (element === videoContainer || element.contains(videoElement)) {
                element.style.opacity = '1'
                element.style.zIndex = '900000'
                element.style.backgroundColor = 'black'
            } else if (!processedElements.has(element)) {
                element.style.opacity = '0'
                element.style.border = '0 solid transparent'
                processedElements.add(element)
            }
        }

        await Promise.all(
            Array.from(document.querySelectorAll('div')).map(
                (div) =>
                    new Promise<void>((resolve) => {
                        processElement(div as HTMLElement)
                        resolve()
                    }),
            ),
        )

        if (mode !== 'gallery_view' && videoElement && videoContainer) {
            videoElement.style.position = 'fixed'
            videoElement.style.display = 'block'
            videoElement.style.left = '0'
            videoElement.style.top = '0'
            videoElement.style.width = '100%'
            videoElement.style.height = '100%'
            videoElement.style.objectFit = 'contain'
            videoElement.style.zIndex = '900001'

            videoContainer.style.background = '#000'
            videoContainer.style.top = '0'
            videoContainer.style.left = '0'
            videoContainer.style.width = '100vw'
            videoContainer.style.height = '100vh'
            videoContainer.style.position = 'fixed'
            videoContainer.style.display = 'flex'
            videoContainer.style.alignItems = 'center'
            videoContainer.style.justifyContent = 'center'
            videoContainer.style.opacity = '1'
            videoContainer.style.zIndex = '900000'
        }
    } catch (e) {
        console.error('Error in removeInitialShityHtml:', e)
    }
}

export function removeShityHtml(mode: RecordingMode): void {
    try {
        function processNewElement(element: HTMLElement) {
            if (element === videoContainer || element.contains(videoElement)) {
                element.style.opacity = '1'
                element.style.zIndex = '900000'
                element.style.backgroundColor = 'black'
            } else if (!processedElements.has(element)) {
                element.style.opacity = '0'
                element.style.border = '0 solid transparent'
                processedElements.add(element)
            }
        }

        document.querySelectorAll('div').forEach((div) => {
            processNewElement(div as HTMLElement)
        })

        if (mode !== 'gallery_view') {
            const secondVideo = document.getElementsByTagName(
                'video',
            )[1] as HTMLVideoElement
            if (secondVideo) {
                secondVideo.style.position = 'fixed'
                secondVideo.style.zIndex = '900002'
            }
        }
    } catch (e) {
        console.error('Error in removeShityHtml:', e)
    }
}

export function findAllAttendees(): string[] {
    let images = document.querySelectorAll('img')

    let participants = Array.from(images).filter(
        (img) => img.clientWidth === 32 && img.clientHeight === 32,
    )
    const names: string[] = []
    // https://www.lifewire.com/change-your-name-on-google-meet-5112077
    for (const participant of participants) {
        let currentElement: any = participant

        while (currentElement) {
            // Check if this parent has a child span
            const span = currentElement.querySelector('span')
            if (span) {
                // Found a parent with a child span
                names.push(span.innerText)
                break
            }

            // Move to the next parent
            currentElement = currentElement.parentElement
        }
    }
    return names
}

function findSelfNameInSiblings(element: Element) {
    const siblings = Array.from(element.parentElement?.children!)
    for (const sibling of siblings) {
        if (sibling !== element) {
            const found = sibling.querySelector('[data-self-name]')
            if (found) {
                return found
            }
        }
    }
    return null
}

// Fonction pour explorer l'arbre DOM de manière ascendante et descendante
function findSelfNameRecursive(element: Element): Element | null {
    let currentElement = element

    while (currentElement) {
        // Cherche dans les frères de l'élément courant
        const foundInSiblings = findSelfNameInSiblings(currentElement)
        if (foundInSiblings) {
            return foundInSiblings
        }

        // Passe à l'élément parent
        currentElement = currentElement.parentElement!
    }

    return null
}

// Fonction pour extraire le texte de la div avec role="tooltip"
function extractTooltipText(element: Element) {
    const tooltipDiv = element.querySelector('[role="tooltip"]')
    const textContent = tooltipDiv != null ? tooltipDiv.textContent : null
    return textContent
}
