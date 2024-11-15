export const drainQueue = (queue: any) => {
    return new Promise<void>((resolve, reject) => {
        queue.drain(() => {
            resolve()
        })
    })
}
