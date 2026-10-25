import { passwordRangePrefixSchema } from '#shared/contracts/identity'
import { passwordRange } from '#server/features/identity'

/**
 * `GET /api/password-ranges/{prefix}` (D210): the leaked-password list for a SHA-1 prefix, for the
 * new-password checklist. Public (sign-up has no session) and read-only, rate limited like the
 * public API; it never sees a password, only 5 hex characters. Kept a day in the browser.
 */
export default defineEventHandler(async (event) => {
  const prefix = parseInput(passwordRangePrefixSchema, getRouterParam(event, 'prefix'))
  const range = await passwordRange(prefix)
  setResponseHeader(event, 'Cache-Control', 'private, max-age=86400')
  return range
})
