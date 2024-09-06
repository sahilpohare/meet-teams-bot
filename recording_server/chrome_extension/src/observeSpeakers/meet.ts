import { RecordingMode, SpeakerData } from '../observeSpeakers'

const SPEAKER_LATENCY = 0 // ms

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
): SpeakerData[] {
    try {
        let elems = document
            .querySelector("[aria-label='Participants']")!
            .querySelectorAll('*')
        let childs = Array.from(elems).filter((elem) => {
            let color = getComputedStyle(elem).backgroundColor
            return (
                color == 'rgba(26, 115, 232, 0.9)' ||
                color == 'rgb(26, 115, 232)'
            )
        })

        // Return the speaker name
        // Find parent recursively with given aria-label (with role as listitem)
        const findParentWithAriaLabel = (element) => {
            const hasAriaLabel = (el) => el?.getAttribute('aria-label')?.trim()
            return hasAriaLabel(element) &&
                element.getAttribute('role') === 'listitem'
                ? element
                : element?.parentElement
                ? findParentWithAriaLabel(element.parentElement)
                : null
        }

        let timestamp = Date.now() - SPEAKER_LATENCY
        return childs.map((child) => {
            const background_position_x = getComputedStyle(
                child.children[1],
            ).backgroundPositionX
            return {
                name: findParentWithAriaLabel(child).ariaLabel,
                id: 0,
                timestamp,
                isSpeaking: background_position_x !== '0px',
            }
        })
    } catch (e) {
        console.error('error in getSpeakerFromMutation', e)
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
