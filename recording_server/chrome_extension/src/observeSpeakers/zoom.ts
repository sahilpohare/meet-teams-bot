import { Speaker } from '../observeSpeakers'

export const MIN_SPEAKER_DURATION = 1000
export const SPEAKER_LATENCY = 500

export async function getSpeakerRootToObserve(
    mutationObserver: MutationObserver,
): Promise<void> {
    try {
        const div = document.getElementsByClassName(
            'speaker-bar-container__horizontal-view-wrap',
        )[0] as any
        div.style.opacity = 0
    } catch (e) {}
    // try {
    //     const divView0 = (document.getElementsByClassName('multi-view')[0].children[0] as any).style.height = '126vh'
    // } catch (e) {
    // }
    // try {
    //     const divView1 = (document.getElementsByClassName('multi-view')[0].children[0] as any).style.width = '146vw'
    // } catch (e) {
    // }
    // try {
    //     const divView2 = (document.getElementsByClassName('multi-view')[0].children[0] as any).style.left = '-23vw'
    // } catch (e) {
    // }
    // try {
    //     const divView3 = (document.getElementsByClassName('multi-view')[0].children[0] as any).style.top = '-26vh'
    // } catch (e) {
    // }
    try {
        const divView4 = ((
            document.getElementsByClassName('multi-view')[0].children[0] as any
        ).style.zIndex = '21')
    } catch (e) {}
    try {
        let meetingInfo = document.getElementsByClassName(
            'meeting-info-container',
        )
        meetingInfo[0].remove()
    } catch (e) {}
    try {
        let notif = document.getElementsByClassName(
            'notification-message-feature-wrap',
        )
        notif[0].remove()
    } catch (e) {}
    try {
        let footerInner = document.getElementsByClassName('footer__inner')
        footerInner[0].remove()
    } catch (e) {}
    try {
        let fullScreenIcon = document.getElementsByClassName('full-screen-icon')
        fullScreenIcon[0].remove()
    } catch (e) {}
    const root = document.querySelector('body')!
    mutationObserver.observe(root, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
        attributeOldValue: true,
        characterDataOldValue: true,
    })
}

export function getSpeakerFromDocument(
    currentSpeaker: string | null,
    mutation,
): Speaker[] {
    const speaker =
        getAvatarAndSpeaker(
            document.getElementsByClassName(
                'speaker-active-container__video-frame',
            ),
        ) ||
        getAvatarAndSpeaker(
            document.getElementsByClassName(
                'speaker-bar-container__video-frame--active',
            ),
        ) ||
        getAvatarAndSpeaker(
            document.getElementsByClassName(
                'gallery-video-container__video-frame',
            ),
        ) ||
        getAvatarAndSpeaker(
            document.getElementsByClassName(
                'suspension-video-container__video-frame',
            ),
        )
    if (speaker) {
        return [{ name: speaker, timestamp: Date.now() }]
    } else {
        return []
    }
    // getAvatarAndSpeaker(document.getElementsByClassName('suspension-window-container')) ||
    // getAvatarAndSpeaker(document.getElementsByClassName('suspension-window-container__tabs'))

    // const allHtml = new XMLSerializer().serializeToString(document)
    // console.log({ allHtml })

    // const allClasses = getAllClasses()
    // console.log(allClasses)

    // const root = document.getElementsByClassName('meeting-client')[0]
    // console.log('[ObserveSpeaker]', { root })
}

function getAvatarAndSpeaker(target) {
    if (target && target[0]) {
        const speakerActiveDiv = target[0]
        const avatarDivs = speakerActiveDiv.getElementsByClassName(
            'video-avatar__avatar',
        )
        if (avatarDivs && avatarDivs[0]) {
            // console.log('[ObserveSpeaker]', { avatarDivs })
            const avatarDiv = avatarDivs[0]
            // console.log('[ObserveSpeaker]', { avatarDiv })
            const initialSpeaker = getSpakerNameFromAvatarDiv(avatarDiv)
            // console.log(initialSpeaker)
            return initialSpeaker
        }
    }
}

function getSpakerNameFromAvatarDiv(target): string | undefined {
    const span = target.getElementsByTagName('span')[0]
    // console.log({ span })
    const name = span.innerText
    // console.log(name)
    //     let name: string | undefined = undefined
    //     const children = target.children
    //     for (let i = 0; i < children.length; i++) {
    //         const c = children[i]
    //         console.log(c.className)
    // 0: div.
    // 		if (c.className === 'video-avatar__avatar-title')
    //         if (c.className === 'video-avatar__avatar-name' || c.className === 'video-avatar__avatar-footer') {
    //             if (c.children && c.children.length > 0)
    //                 name = c.children[0].innerText
    //         }
    //     }
    return name
}

// function getSpakerNameFromMutation(mutation): string | undefined {
//     const addedNodes = mutation.addedNodes
//     for (const item of addedNodes) {
//         console.log({ item })
//         if (item && item.nodeName === "SPAN" && item.innerText && item.innerText !== "") {
//             return item.innerText
//         }
//         else if (item && item.nodeName === "#text" && item.nodeValue && item.nodeValue !== "") {
//             return item.nodeValue
//         }
//         else {
//             if (item.getElementsByTagName != null) {
//                 const divWhenSharing = item.getElementsByClassName('.speaker-bar-container__video-frame--active')
//                 if (divWhenSharing && divWhenSharing[0]) {
//                     console.log({ divWhenSharing })
//                 } else {
//                     getSpeakerFromDocument()
//                     // const span = item.getElementsByTagName('span')
//                     // if (span != null && span.length > 0) {
//                     //     return span[0].innerText
//                     // }
//                 }
//             }
//         }
//     }
//     return undefined
// }

export function removeShityHtml() {
    try {
        let notif = document.getElementsByClassName(
            'notification-message-feature-wrap',
        )
        notif[0].remove()
    } catch (e) {}

    const sharedScreen =
        document.getElementsByClassName('Pane vertical Pane1  ').length > 0
    console.log({ sharedScreen })

    if (!sharedScreen) {
        try {
            const divView0 = ((
                document.getElementsByClassName('multi-view')[0]
                    .children[0] as any
            ).style.height = '126vh')
        } catch (e) {}
        try {
            const divView1 = ((
                document.getElementsByClassName('multi-view')[0]
                    .children[0] as any
            ).style.width = '146vw')
        } catch (e) {}
        try {
            const divView2 = ((
                document.getElementsByClassName('multi-view')[0]
                    .children[0] as any
            ).style.left = '-23vw')
        } catch (e) {}
        try {
            const divView3 = ((
                document.getElementsByClassName('multi-view')[0]
                    .children[0] as any
            ).style.top = '-26vh')
        } catch (e) {}
    } else {
        try {
            const divView0 = ((
                document.getElementsByClassName('multi-view')[0]
                    .children[0] as any
            ).style.height = 'auto')
        } catch (e) {}
        try {
            const divView1 = ((
                document.getElementsByClassName('multi-view')[0]
                    .children[0] as any
            ).style.width = 'auto')
        } catch (e) {}
        try {
            const divView2 = ((
                document.getElementsByClassName('multi-view')[0]
                    .children[0] as any
            ).style.left = 'auto')
        } catch (e) {}
        try {
            const divView3 = ((
                document.getElementsByClassName('multi-view')[0]
                    .children[0] as any
            ).style.top = 'auto')
        } catch (e) {}
    }
    try {
        const divView4 = ((
            document.getElementsByClassName('multi-view')[0].children[0] as any
        ).style.zIndex = '21')
    } catch (e) {}
    try {
        let meetingInfo = document.getElementsByClassName(
            'meeting-info-container',
        )
        meetingInfo[0].remove()
    } catch (e) {}
    try {
        let notif = document.getElementsByClassName(
            'notification-message-feature-wrap',
        )
        notif[0].remove()
    } catch (e) {}
    try {
        let footerInner = document.getElementsByClassName('footer__inner')
        footerInner[0].remove()
    } catch (e) {}
    try {
        let fullScreenIcon = document.getElementsByClassName('full-screen-icon')
        fullScreenIcon[0].remove()
    } catch (e) {}
    // fullScreenIcon[0].remove()
}

export function findAllAttendees(): string[] {
    return []
}
