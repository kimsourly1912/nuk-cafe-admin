import { resolveTableToken } from '#server/features/branches'

/**
 * `GET /api/public/tables/{token}`: the branch and table a scanned QR names, for anyone. Unknown
 * tokens, archived tables and archived branches are all 404 (D91).
 */
export default defineEventHandler(async (event) => {
  return resolveTableToken(useDb(), getRouterParam(event, 'token') ?? '')
})
