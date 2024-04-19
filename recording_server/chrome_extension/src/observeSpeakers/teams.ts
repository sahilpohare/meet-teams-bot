import { Speaker } from '../observeSpeakers'
import { sleep } from '../utils'

export const MIN_SPEAKER_DURATION = 0
export const SPEAKER_LATENCY = 900

export async function getSpeakerRootToObserve(
    mutationObserver: MutationObserver,
): Promise<void> {
    await sleep(1000)
    try {
        var documentInIframe = getDocumentRoot()!
        let meetingControls = documentInIframe!.querySelectorAll(
            `div[data-tid="app-layout-area--header"]`,
        )
        meetingControls[0].remove()
    } catch (e) {
        console.error('fail to remove buttons header', e)
    }

    try {
        var documentInIframe = getDocumentRoot()!
        const config = {
            attributes: true,
            childList: true,
            subtree: true,
            attributeFilter: ['class'],
        }

        mutationObserver.observe(documentInIframe, config)
    } catch (e) {
        console.error('fail to observe voice-level-stream-outline', e)
    }
}

// Création d'un dictionnaire pour garder la trace de l'état de chaque speaker

export function getSpeakerFromDocument(
    currentSpeaker: string | null,
    mutation,
): Speaker[] {
    if (
        mutation != null &&
        mutation.type === 'attributes' &&
        mutation.attributeName === 'class'
    ) {
        const targetElement = mutation.target
        const parentDiv = targetElement.parentElement
        const beforeElementStyles = window.getComputedStyle(
            targetElement as Element,
            '::before',
        )
        const currentBorderColor =
            beforeElementStyles.getPropertyValue('border-color')

        const span = parentDiv?.querySelector('span')

        const speaker = span?.textContent
        // Vérifier si la couleur de la bordure est rgb(127, 133, 245)
        if (
            (targetElement as Element).getAttribute('data-tid') ===
            'voice-level-stream-outline'
        ) {
            if (currentBorderColor.trim() === 'rgb(127, 133, 245)') {
                console.log('[teams observe speaker]', targetElement)
                if (span != null && speaker != null && speaker.trim() !== '') {
                    // targetElement.style.border = '1px solid red';
                    // span.style.color = 'red'
                    removeShityHtml()
                    // console.log('Speaker started:', speaker, targetElement, span)
                    return [{ name: speaker, timestamp: Date.now() }]
                }
            } else if (currentBorderColor.trim() !== 'rgb(127, 133, 245)') {
                if (span != null && speaker != null && speaker.trim() !== '') {
                    // targetElement.style.border = '1px solid green';
                    // span.style.color = 'green'
                    removeShityHtml()
                    // console.log('Speaker stopped:', speaker, targetElement, span)
                    return []
                }
            }
        }
    }

    return []
}

function getDocumentRoot() {
    var iframes = document.querySelectorAll('iframe')
    var firstIframe = iframes[0]
    return firstIframe
        ? firstIframe.contentDocument || firstIframe.contentWindow?.document
        : document
}

export function removeShityHtml() {
    try {
        var documentInIframe = getDocumentRoot()!
        var menus = documentInIframe.querySelectorAll('[role="menu"]')
            ? documentInIframe.querySelectorAll('[role="menu"]')
            : documentInIframe.querySelector('[role="menu"]')
        // sélectionnez la div en question
        var menu = menus![0] ? menus![0] : menus
        menu.style.position = 'fixed'
        menu.style.top = '0'
        menu.style.left = '0'
        menu.style.width = '100vw'
        menu.style.height = '100vh'
        menu.style.zIndex = '9999'
        menu.style.backgroundColor = 'black'
    } catch (e) {
        console.error('error in remove shitty html', e)
    }
}

export function findAllAttendees(): string[] {
    return []
}
