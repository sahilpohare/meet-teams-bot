import { RecordingMode } from '../observeSpeakers'

// TODO: question pour Micka:
// Comment je communique avec zoom? Axios dans zoom?
// Est ce que je dois utiliser l'extension?
// setMeetingProvider remonte dans le server?
// est ce qu'on veut pouvoir piloter toutes les fonctions depuis recording_server?

export const MIN_SPEAKER_DURATION = 1000
export const SPEAKER_LATENCY = 500

export async function getSpeakerRootToObserve(
    mutationObserver: MutationObserver,
    recordingMode: RecordingMode,
): Promise<void> {
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

//class="gallery-video-container__video-frame gallery-video-container__video-frame--active react-draggable"
export function getSpeakerFromDocument(
    currentSpeaker: string | null,
    mutation: MutationRecord | null,
    recordingMode: RecordingMode,
): any[] {
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

// export function removeShityHtml(mode: RecordingMode) {
//     try {
//         let notif = document.getElementsByClassName(
//             'notification-message-feature-wrap',
//         )
//         notif[0].remove()
//     } catch (e) {}

//     if (mode !== 'gallery_view') {
//         const sharedScreen =
//             document.getElementsByClassName('Pane vertical Pane1  ').length > 0

//         if (!sharedScreen) {
//             try {
//                 ;(
//                     document.getElementsByClassName('multi-view')[0]
//                         .children[0] as any
//                 ).style.height = '126vh'
//             } catch (e) {}
//             try {
//                 ;(
//                     document.getElementsByClassName('multi-view')[0]
//                         .children[0] as any
//                 ).style.width = '146vw'
//             } catch (e) {}
//             try {
//                 ;(
//                     document.getElementsByClassName('multi-view')[0]
//                         .children[0] as any
//                 ).style.left = '-23vw'
//             } catch (e) {}
//             try {
//                 ;(
//                     document.getElementsByClassName('multi-view')[0]
//                         .children[0] as any
//                 ).style.top = '-26vh'
//             } catch (e) {}
//         } else {
//             try {
//                 ;(
//                     document.getElementsByClassName('multi-view')[0]
//                         .children[0] as any
//                 ).style.height = 'auto'
//             } catch (e) {}
//             try {
//                 ;(
//                     document.getElementsByClassName('multi-view')[0]
//                         .children[0] as any
//                 ).style.width = 'auto'
//             } catch (e) {}
//             try {
//                 ;(
//                     document.getElementsByClassName('multi-view')[0]
//                         .children[0] as any
//                 ).style.left = 'auto'
//             } catch (e) {}
//             try {
//                 ;(
//                     document.getElementsByClassName('multi-view')[0]
//                         .children[0] as any
//                 ).style.top = 'auto'
//             } catch (e) {}
//         }
//         try {
//             const divView4 = ((
//                 document.getElementsByClassName('multi-view')[0]
//                     .children[0] as any
//             ).style.zIndex = '21')
//         } catch (e) {}
//         try {
//             let meetingInfo = document.getElementsByClassName(
//                 'meeting-info-container',
//             )
//             meetingInfo[0].remove()
//         } catch (e) {}
//     }
//     try {
//         let notif = document.getElementsByClassName(
//             'notification-message-feature-wrap',
//         )
//         notif[0].remove()
//     } catch (e) {}
//     try {
//         let footerInner = document.getElementsByClassName('footer__inner')
//         footerInner[0].remove()
//     } catch (e) {}
//     try {
//         let fullScreenIcon = document.getElementsByClassName('full-screen-icon')
//         fullScreenIcon[0].remove()
//     } catch (e) {}
//     // fullScreenIcon[0].remove()
// }

export function findAllAttendees(): string[] {
    return []
}

// export async function removeInitialShityHtml(mode: RecordingMode) {
//     try {
//         const div = document.getElementsByClassName(
//             'speaker-bar-container__horizontal-view-wrap',
//         )[0] as any
//         div.style.opacity = 0
//     } catch (e) {}
//     // try {
//     //     const divView0 = (document.getElementsByClassName('multi-view')[0].children[0] as any).style.height = '126vh'
//     // } catch (e) {
//     // }
//     // try {
//     //     const divView1 = (document.getElementsByClassName('multi-view')[0].children[0] as any).style.width = '146vw'
//     // } catch (e) {
//     // }
//     // try {
//     //     const divView2 = (document.getElementsByClassName('multi-view')[0].children[0] as any).style.left = '-23vw'
//     // } catch (e) {
//     // }
//     // try {
//     //     const divView3 = (document.getElementsByClassName('multi-view')[0].children[0] as any).style.top = '-26vh'
//     // } catch (e) {
//     // }
//     try {
//         ;(
//             document.getElementsByClassName('multi-view')[0].children[0] as any
//         ).style.zIndex = '21'
//     } catch (e) {}
//     try {
//         let meetingInfo = document.getElementsByClassName(
//             'meeting-info-container',
//         )
//         meetingInfo[0].remove()
//     } catch (e) {}
//     try {
//         let notif = document.getElementsByClassName(
//             'notification-message-feature-wrap',
//         )
//         notif[0].remove()
//     } catch (e) {}
//     try {
//         let footerInner = document.getElementsByClassName('footer__inner')
//         footerInner[0].remove()
//     } catch (e) {}
//     try {
//         let fullScreenIcon = document.getElementsByClassName('full-screen-icon')
//         fullScreenIcon[0].remove()
//     } catch (e) {}
// }
