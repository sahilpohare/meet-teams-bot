import * as asyncLib from 'async'

export function newSerialQueue() {
    return asyncLib.queue(async function(task: () => Promise<void>, done: any) {
        await task()
        done()
    }, 1)
}

export function newTranscribeQueue() {
    return asyncLib.queue(async function(task: () => Promise<void>, done: any) {
        await task()
        done()
    }, 10)
}

export const drainQueue = (queue: any) => {
    return new Promise((resolve, reject) => {
        queue.drain(() => {
            resolve();
        });
    });
}


