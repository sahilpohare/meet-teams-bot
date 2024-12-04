import { RecordingMode } from '../api'

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

    // People panel shitty HTML remove
    let root: any = null
    while (root == null) {
        root = (Array as any)
            .from(document.querySelectorAll('div'))
            .find((d) => d.innerText === 'People')?.parentElement?.parentElement
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

    // People panel shitty HTML remove
    let root: any = null
    while (root == null) {
        root = (Array as any)
            .from(document.querySelectorAll('div'))
            .find((d) => d.innerText === 'People')?.parentElement?.parentElement
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
