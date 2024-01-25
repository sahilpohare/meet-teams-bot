import { Speaker } from '../observeSpeakers'
import { sleep } from '../utils'
export const MIN_SPEAKER_DURATION = 200
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
            // Set interval to log and reset speaker counts every 100 ms
            setInterval(calcSpeaker, 100)
        } else {
            console.error('could not find root speaker to observe')
        }
        await sleep(1000)
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
    mutation,
): Speaker[] {
    const speaker = getSpeakerFromMutation(mutation)
    // chrome.runtime.sendMessage({
    //     type: 'LOG_FROM_SCRIPT',
    //     payload: {
    //         log: `mutation speaker found: ${speaker}`,
    //         timestamp: Date.now(),
    //     },
    // })
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

export function getSpeakerFromMutation(mutation): string | null {
    if (mutation == null) {
        return null
    }
    try {
        const target = mutation.target
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
        let speakers: string[] = []
        const divButton = target.parentElement.parentElement.parentElement
        // console.log({ divButton })
        if (divButton && divButton.nodeName === 'BUTTON') {
            const divSpeaker =
                divButton.parentElement.parentElement.parentElement
                    .parentElement.parentElement.parentElement
            const speakerName = divSpeaker && findSpeakerName(divSpeaker)
            if (speakerName) {
                return speakerName
            } else {
                const divSpeaker =
                    divButton.parentElement.parentElement.parentElement
                        .parentElement
                const speakerName = divSpeaker && findSpeakerName(divSpeaker)
                if (speakerName) {
                    return speakerName
                } else {
                    console.error('no div speaker button', { mutation })
                    // chrome.runtime.sendMessage({
                    //     type: 'LOG_FROM_SCRIPT',
                    //     payload: {
                    //         log: 'no div speaker button',
                    //         timestamp: Date.now(),
                    //     },
                    // })
                }
            }
        } else {
            const divSpeaker =
                mutation.target.parentElement.parentElement.parentElement
                    .parentElement
            if (divSpeaker) {
                const speakerName = findSpeakerName(divSpeaker)
                if (speakerName) {
                    return speakerName
                } else {
                    // chrome.runtime.sendMessage({
                    //     type: 'LOG_FROM_SCRIPT',
                    //     payload: {
                    //         log: 'no div speaker',
                    //         timestamp: Date.now(),
                    //     },
                    // })
                    console.error('no div speaker', { mutation })
                }
            } else {
                // chrome.runtime.sendMessage({
                //     type: 'LOG_FROM_SCRIPT',
                //     payload: {
                //         log: 'no div speaker',
                //         timestamp: Date.now(),
                //     },
                // })
                console.error('no div speaker', { mutation })
            }
        }
        // })
        return null
    } catch (e) {
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
