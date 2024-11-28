import { RecordingMode, SpeakerData } from '../observeSpeakers'

export const SPEAKER_LATENCY = 0 // ms

export async function getSpeakerRootToObserve(
    recordingMode: RecordingMode,
): Promise<[Node, MutationObserverInit] | undefined> {
    if (recordingMode === 'gallery_view') {
        return [
            document,
            {
                attributes: true,
                characterData: true,
                childList: true,
                subtree: true,
                attributeFilter: ['class'],
            },
        ]
    } else {
        // People panel shitty HTML remove
        let root: any = null
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
            }
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
        return [
            document.querySelector("[aria-label='Participants']")!,
            {
                attributes: true,
                characterData: true,
                childList: true,
                subtree: true,
                attributeFilter: ['class'],
            },
        ]
    }
}

export function getSpeakerFromDocument(
    _recordingMode: RecordingMode,
    timestamp: number,
    _bot_name: string
): SpeakerData[] {
    try {
        console.log(
            '[getSpeakerFromDocument] - Starting participant detection...',
        )

        const participantsList = document.querySelector(
            "[aria-label='Participants']",
        )!
        const participantItems =
            participantsList.querySelectorAll('[role="listitem"]')
        console.log(
            '[getSpeakerFromDocument] - Found participants items:',
            participantItems.length,
        )

        // Map to store unique participants with their speaking status
        const uniqueParticipants = new Map<
            string,
            {
                name: string
                isSpeaking: boolean
                isPresenting: boolean
            }
        >()

        participantItems.forEach((item, index) => {
            const ariaLabel = item.getAttribute('aria-label')?.trim()
            if (!ariaLabel) {
                console.warn(
                    '[getSpeakerFromDocument] - Participant item without aria-label found:',
                    item,
                )
                return
            }

            console.log(
                `[getSpeakerFromDocument] - Processing participant ${
                    index + 1
                }/${participantItems.length}:`,
                ariaLabel,
            )

            // Check if this participant is already in our map
            if (!uniqueParticipants.has(ariaLabel)) {
                console.log(
                    '[getSpeakerFromDocument] - New participant detected:',
                    ariaLabel,
                )
                uniqueParticipants.set(ariaLabel, {
                    name: ariaLabel,
                    isSpeaking: false,
                    isPresenting: false,
                })
            } else {
                console.log(
                    '[getSpeakerFromDocument] - Updating existing participant:',
                    ariaLabel,
                )
            }

            const participant = uniqueParticipants.get(ariaLabel)!

            // Check if participant is presenting
            const allDivs = Array.from(item.querySelectorAll('div'))
            console.log(
                '[getSpeakerFromDocument] - Checking presentation status...',
            )
            const isPresenting = allDivs.some((div) => {
                const text = div.textContent?.trim()
                if (text === 'Presentation') {
                    console.log(
                        '[getSpeakerFromDocument] - Presentation detected for:',
                        ariaLabel,
                    )
                    return true
                }
                return false
            })

            if (isPresenting) {
                participant.isPresenting = true
            }

            // Check for speaking indicators
            console.log('🎤 Checking speaking indicators...')
            const speakingIndicators = Array.from(
                item.querySelectorAll('*'),
            ).filter((elem) => {
                const color = getComputedStyle(elem).backgroundColor
                const isIndicator =
                    color === 'rgba(26, 115, 232, 0.9)' ||
                    color === 'rgb(26, 115, 232)'
                if (isIndicator) {
                    console.log(
                        '[getSpeakerFromDocument] - Found speaking indicator:',
                        color,
                    )
                }
                return isIndicator
            })

            console.log('Found speaking indicators:', speakingIndicators.length)

            // Check background position for speaking status
            speakingIndicators.forEach((indicator) => {
                const backgroundElement = indicator.children[1]
                if (backgroundElement) {
                    const backgroundPosition =
                        getComputedStyle(backgroundElement).backgroundPositionX
                    console.log(
                        '[getSpeakerFromDocument] - Background position:',
                        backgroundPosition,
                    )
                    if (backgroundPosition !== '0px') {
                        console.log(
                            '[getSpeakerFromDocument] - Speaking detected for:',
                            ariaLabel,
                        )
                        participant.isSpeaking = true
                    }
                }
            })

            // Update the map with potentially modified participant data
            uniqueParticipants.set(ariaLabel, participant)
            console.log(
                '[getSpeakerFromDocument] - Current status for',
                ariaLabel,
                ':',
                {
                    isSpeaking: participant.isSpeaking,
                    isPresenting: participant.isPresenting,
                },
            )
        })

        // Convert map to array of SpeakerData
        const result = Array.from(uniqueParticipants.values()).map(
            (participant) => ({
                name: participant.name,
                id: 0,
                timestamp,
                isSpeaking: participant.isSpeaking,
            }),
        )

        console.log('[getSpeakerFromDocument] - Final results:', result)
        return result
    } catch (e) {
        console.error(
            '[getSpeakerFromDocument] - Error in getSpeakerFromDocument:',
            e,
        )
        return []
    }
}

export async function removeInitialShityHtml(mode: RecordingMode) {
    let div
    try {
        for (div of document.getElementsByTagName('div')) {
            if (
                div.clientHeight === 132 &&
                (div.clientWidth === 235 || div.clientWidth === 234)
            ) {
                div.style.display = 'none'
            }
        }
    } catch (e) {}
    try {
        for (div of document.getElementsByTagName('div')) {
            if (div.clientWidth === 360 && div.clientHeight === 326) {
                div.style.display = 'none'
            }
        }
    } catch (e) {}
    try {
        for (div of document.getElementsByTagName('div')) {
            if (div.clientHeight === 26) {
                div.style.display = 'none'
            }
        }
    } catch (e) {}
    try {
        for (div of document.getElementsByTagName('div')) {
            if (div.clientHeight === 20) {
                div.style.display = 'none'
            }
        }
    } catch (e) {}
    try {
        let span
        for (span of document.getElementsByTagName('span')) {
            if (span.innerText.includes(':')) {
                span.parentElement.parentElement.style.display = 'none'
            }
        }
    } catch (e) {}
    try {
        removeBlackBox()
    } catch (e) {
        console.error('Error with removeBlackBox:', e)
    }
    try {
        const politeDivs = document.querySelectorAll('div[aria-live="polite"]')
        politeDivs.forEach((div) => {
            ;(div as HTMLElement).style.opacity = '0'
        })
    } catch (e) {
        console.error('Error setting opacity for aria-live="polite" divs:', e)
    }

    try {
        const bannerDiv = document.querySelector(
            'div[role="banner"]',
        ) as HTMLElement
        if (bannerDiv) {
            bannerDiv.style.opacity = '0'
        }
    } catch (e) {
        console.error('Error with banner div:', e)
    }

    if (mode !== 'gallery_view') {
        try {
            const video = document.getElementsByTagName(
                'video',
            )[0] as HTMLVideoElement
            if (video) {
                video.style.position = 'fixed'
                video.style.display = 'block'
                video.style.left = '0'
                video.style.top = '0'
                video.style.zIndex = '900000'
                if (video?.parentElement?.style) {
                    video.parentElement.style.background = '#000'
                    video.parentElement.style.top = '0'
                    video.parentElement.style.left = '0'
                    video.parentElement.style.width = '100vw'
                    video.parentElement.style.height = '100vh'
                    video.parentElement.style.position = 'fixed'
                    video.parentElement.style.display = 'flex'
                    video.parentElement.style.alignItems = 'center'
                    video.parentElement.style.justifyContent = 'center'
                }
            }
        } catch (e) {}
    }
}

export function removeShityHtml(mode: RecordingMode) {
    // '#a8c7fa'
    if (mode !== 'gallery_view') {
        try {
            const video = document.getElementsByTagName(
                'video',
            )[0] as HTMLVideoElement
            if (video) {
                video.style.position = 'fixed'
                video.style.display = 'block'
                video.style.left = '0'
                video.style.top = '0'
                video.style.zIndex = '1'
                if (video?.parentElement?.style) {
                    video.parentElement.style.background = '#000'
                    video.parentElement.style.top = '0'
                    video.parentElement.style.left = '0'
                    video.parentElement.style.width = '100vw'
                    video.parentElement.style.height = '100vh'
                    video.parentElement.style.position = 'fixed'
                    video.parentElement.style.display = 'flex'
                    video.parentElement.style.alignItems = 'center'
                    video.parentElement.style.justifyContent = 'center'
                }
            }
        } catch (e) {
            console.error('Error with video setup:', e)
        }
        try {
            document.getElementsByTagName('video')[1].style.position = 'fixed'
        } catch (e) {
            console.error('Error with second video:', e)
        }
        try {
            removeBlackBox()
        } catch (e) {
            console.error('Error with removeBlackBox:', e)
        }
    }

    try {
        for (const div of document.getElementsByTagName('div')) {
            if (div.clientHeight === 164 && div.clientWidth === 322) {
                div.style.display = 'none'
            }
        }
    } catch (e) {}
    try {
        for (const div of document.getElementsByTagName('div')) {
            if (div.clientHeight === 40) {
                div.style.opacity = '0'
            }
        }
    } catch (e) {}
    try {
        const bannerDiv = document.querySelector(
            'div[role="banner"]',
        ) as HTMLElement
        if (bannerDiv) {
            bannerDiv.style.opacity = '0'
        }
    } catch (e) {
        console.error('Error with banner div:', e)
    }
    try {
        const politeDivs = document.querySelectorAll('div[aria-live="polite"]')
        politeDivs.forEach((div) => {
            ;(div as HTMLElement).style.opacity = '0'
        })
    } catch (e) {
        console.error('Error setting opacity for aria-live="polite" divs:', e)
    }
    try {
        var icons = Array.from(
            document.querySelectorAll('i.google-material-icons'),
        ).filter((el) => el.textContent?.trim() === 'devices')
        icons.forEach((icon) => {
            // Change the opacity of the parent element to 0
            if (icon.parentElement) {
                icon.parentElement.style.opacity = '0'
            }
        })
    } catch (e) {
        console.error('Error applying opacity:', e)
    }

    // Add opacity change for 'mood' icons with specific parent background
    try {
        var moodIcons = Array.from(
            document.querySelectorAll('i.google-material-icons'),
        ).filter((el) => el.textContent?.trim() === 'mood')
        if (moodIcons.length > 0) {
            var icon = moodIcons[0]
            var currentElement = icon.parentElement
            while (currentElement != null) {
                var bgColor =
                    window.getComputedStyle(currentElement).backgroundColor
                if (bgColor === 'rgb(32, 33, 36)') {
                    currentElement.style.opacity = '0'
                    break
                }
                currentElement = currentElement.parentElement
            }
        } else {
            console.log("No 'mood' icon found.")
        }
    } catch (e) {
        console.error("Error finding 'mood' icon:", e)
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

function removeBlackBox(): void {
    // Sélectionner tous les éléments avec l'attribut data-layout='roi-crop'
    const elements: NodeListOf<HTMLElement> = document.querySelectorAll(
        '[data-layout="roi-crop"]',
    )

    if (elements.length === 0) {
        console.log("Aucun élément trouvé avec data-layout='roi-crop'")
        return
    }

    // Trouver l'élément avec la plus grande largeur
    let maxWidth: number = 0
    let maxElement: HTMLElement | null = null

    elements.forEach((el: HTMLElement) => {
        const width: number = el.offsetWidth
        if (width > maxWidth) {
            maxWidth = width
            maxElement = el
        }
    })

    // Appliquer les styles aux autres éléments et leurs parents
    elements.forEach((el: HTMLElement) => {
        if (el == maxElement) {
            el.style.opacity = '1'
            el.style.top = '0'
            el.style.left = '0'
            el.style.position = 'fixed'
            el.style.zIndex = '9000'
            el.style.backgroundColor = 'black'
        } else {
            applyStylesRecursively(el, 4)
        }
    })

    console.log('Styles appliqués avec succès')
}

function applyStylesRecursively(
    element: HTMLElement | null,
    depth: number,
): void {
    if (depth < 0 || !element) return

    element.style.opacity = '0'
    element.style.border = 'transparent'

    applyStylesRecursively(element.parentElement, depth - 1)
}
