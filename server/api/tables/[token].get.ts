import { scanTableToken } from '#server/features/branches'

/**
 * `GET /api/tables/{token}`: the table a scanned QR names, its branch and its cafe, for anyone
 * (D91, D140). Global: a printed code has no cafe in it, so the token finds the cafe. Unknown
 * tokens, archived tables or branches and paused cafes are all 404.
 */
export default defineEventHandler(async (event) => {
  return scanTableToken(useDb(), getRouterParam(event, 'token') ?? '')
})
