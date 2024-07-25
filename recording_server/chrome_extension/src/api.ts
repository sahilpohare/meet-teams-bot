import * as apiMethodsImport from './api/methods'

export const api = { ...apiMethodsImport }

export * from './api/types'
export { setConfig, SpokeApiConfig } from './api/axios'
export { sleep } from './api/utils'
