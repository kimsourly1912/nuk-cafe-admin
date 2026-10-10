import * as v from 'valibot'

/**
 * A browser error nobody caught (D149): `POST /api/client-errors`, written to Workers Logs only.
 * The text is the browser's, so it is never shown to anyone in the app or sent to Telegram.
 */

export const CLIENT_ERROR_KINDS = ['vue', 'error', 'rejection'] as const
export const CLIENT_ERROR_MESSAGE_MAX = 1000
export const CLIENT_ERROR_STACK_MAX = 4000
export const CLIENT_ERROR_PAGE_MAX = 500

export const clientErrorSchema = v.object({
  /** Where it was caught: Vue's error handler, the window's `error`, or an unhandled rejection. */
  kind: v.picklist(CLIENT_ERROR_KINDS),
  message: v.pipe(v.string(), v.maxLength(CLIENT_ERROR_MESSAGE_MAX)),
  stack: v.optional(v.pipe(v.string(), v.maxLength(CLIENT_ERROR_STACK_MAX))),
  /** The page's path, without its query or hash (a reset link's token lives there). */
  page: v.pipe(v.string(), v.maxLength(CLIENT_ERROR_PAGE_MAX)),
  /** The app build the browser runs (`buildId`): an error after a deploy names its version. */
  build: v.optional(v.pipe(v.string(), v.maxLength(100))),
})

export type ClientErrorReport = v.InferOutput<typeof clientErrorSchema>
