import { getExtensionId } from "./puppeteer";
import { server } from "./server";
import { summarize } from './test_summarize'

// console.log(process.argv);
if (process.argv[2]?.includes('get_extension_id')) {
    getExtensionId().then(x => console.log(x))
} else if (process.argv[2]?.includes('summarize')) {

    summarize()
} else {
    server()
}
