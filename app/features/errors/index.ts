// Public API of the errors feature (the fatal error page, D143): what `app/error.vue` needs. To add
// an error page: a kind in `classifyError`, its words in `errorCopy`, its view in `ErrorView.vue`.
export { classifyError } from './utils/classify-error'
export type { ErrorKind } from './utils/classify-error'
export { errorCopy } from './utils/error-copy'
export { default as ErrorView } from './components/ErrorView.vue'
