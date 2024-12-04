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

// export function findAllAttendees(): string[] {
//     let images = document.querySelectorAll('img')

//     let participants = Array.from(images).filter(
//         (img) => img.clientWidth === 32 && img.clientHeight === 32,
//     )
//     const names: string[] = []
//     // https://www.lifewire.com/change-your-name-on-google-meet-5112077
//     for (const participant of participants) {
//         let currentElement: any = participant

//         while (currentElement) {
//             // Check if this parent has a child span
//             const span = currentElement.querySelector('span')
//             if (span) {
//                 // Found a parent with a child span
//                 names.push(span.innerText)
//                 break
//             }

//             // Move to the next parent
//             currentElement = currentElement.parentElement
//         }
//     }
//     return names
// }
