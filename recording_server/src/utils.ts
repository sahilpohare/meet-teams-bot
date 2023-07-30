import { resolve, relative } from 'path';
const { readdir } = require('fs').promises;

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

export async function* getFiles(dir) {
    const dirents = await readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
        const res = resolve(dir, dirent.name);
        if (dirent.isDirectory()) {
            yield* getFiles(res);
        } else {
            yield relative(process.cwd(), res);
        }
    }
}
// ['log', 'warn', 'error'].forEach((methodName) => {
//    const originalMethod = console[methodName];
//    console[methodName] = (...args) => {
//        let initiator = 'unknown place';
//        try {
//            throw new Error();
//        } catch (e) {
//            if (typeof e.stack === 'string') {
//                let isFirst = true;
//                for (const line of e.stack.split('\n')) {
//                    const matches = line.match(/^\s+at\s+(.*)/);
//                    if (matches) {
//                        if (!isFirst) { // first line - current function
//                            // second line - caller (what we are looking for)
//                            initiator = matches[1].trim().substr(3);
//                            break;
//                        }
//                        isFirst = false;
//                    }
//                }
//            }
//        }
//        originalMethod.apply(console, [...args, '\n', `  at ${initiator}`]);
//    };
// });
