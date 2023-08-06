import { sleep } from '../utils'
export const MIN_SPEAKER_DURATION = 3000
export const SPEAKER_LATENCY = 500

export async function getSpeakerRootToObserve(
    mutationObserver: MutationObserver,
) {
    let root: any = null

    let div
    try {
        for (div of document.getElementsByTagName('div')) {
            div.clientHeight === 132 && (div.clientWidth === 235 || 234)
                ? (div.style.display = 'none')
                : console.error('fail')
        }
    } catch (e) {}
    try {
        for (div of document.getElementsByTagName('div')) {
            div.clientWidth === 360 && div.clientHeight === 326
                ? (div.style.display = 'none')
                : console.log('')
        }
    } catch (e) {}
    try {
        const video = document.getElementsByTagName(
            'video',
        )[0] as HTMLVideoElement
        if (video) {
            video.style.position = 'fixed'
            video.style.display = 'block'
            video.style.left = '0'
            video.style.top = '0'
            video.style.zIndex = '90000'
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

            try {
                const microphone = Array.from(
                    document.querySelectorAll('button'),
                ).find(
                    (d) =>
                        (d as any)?.ariaLabel ===
                        'Turn off microphone (ctrl + d)',
                )
                if (microphone) {
                    microphone.click()
                }
            } catch (e) {
                console.error(
                    '[getSpeakerRootToObserve] on meet error turning off microphone',
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

export function getSpeakerFromDocument(mutation): string[] {
    if (mutation == null) {
        return []
    }
    try {
        const target = mutation.target
        let color = getComputedStyle(target).backgroundColor
        if (color !== 'rgba(26, 115, 232, 0.9)') {
            return []
        }
        // console.log({ color })
        let styleBar = getComputedStyle(target.children[1])
        const height = styleBar.height
        // console.log(height)

        if (height === '4px') {
            return []
        }
        let speakers: string[] = []
        const divButton = target.parentElement.parentElement.parentElement
        // console.log({ divButton })
        if (divButton && divButton.nodeName === 'BUTTON') {
            const divSpeaker =
                divButton.parentElement.parentElement.parentElement
                    .parentElement.parentElement.parentElement
            const speakerName = divSpeaker && findSpeakerName(divSpeaker)
            if (speakerName) {
                speakers.push(speakerName)
            } else {
                const divSpeaker =
                    divButton.parentElement.parentElement.parentElement
                        .parentElement
                const speakerName = divSpeaker && findSpeakerName(divSpeaker)
                if (speakerName) {
                    speakers.push(speakerName)
                } else {
                    console.log('no div speaker button', { mutation })
                }
            }
        } else {
            const divSpeaker =
                mutation.target.parentElement.parentElement.parentElement
                    .parentElement
            if (divSpeaker) {
                const speakerName = findSpeakerName(divSpeaker)
                if (speakerName) {
                    speakers.push(speakerName)
                }
            } else {
                console.log('no div speaker', { mutation })
            }
        }
        // })
        console.log('SPEAKERS FOUND: ', speakers)
        return speakers
    } catch (e) {
        return []
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

export function removeShityHtml() {
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
    } catch (e) {}
    try {
        document.getElementsByTagName('video')[1].style.position = 'fixed'
    } catch (e) {}
    // let meetingControls = document.getElementsByClassName("calling-controls")
    // meetingControls[0].remove()
}
