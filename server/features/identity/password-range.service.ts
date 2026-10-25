import type { PasswordRange } from '#shared/contracts/identity'
import { passwordCheckUnavailable } from './identity.errors'

/** Fetches a URL's text; a stand-in in tests. */
export type FetchText = (url: string, options: { headers: Record<string, string>, timeout: number }) => Promise<string>

const RANGE_URL = 'https://api.pwnedpasswords.com/range/'

const fetchText: FetchText = (url, options) => $fetch<string>(url, { ...options, responseType: 'text', retry: 0 })

/**
 * The leaked passwords whose SHA-1 starts with `prefix` (5 upper-case hex characters), from Have I
 * Been Pwned's range API, the one Better Auth's `haveIBeenPwned` checks on save (D210). Padding is
 * asked for, so the answer's size doesn't hint at the prefix; padded lines have a count of 0 and are
 * dropped. An unreachable or odd answer is `PASSWORD_CHECK_UNAVAILABLE` (503): the field then says
 * it's checked when saved.
 */
export async function passwordRange(prefix: string, fetch: FetchText = fetchText): Promise<PasswordRange> {
  let body: string
  try {
    body = await fetch(RANGE_URL + prefix, { headers: { 'Add-Padding': 'true', 'User-Agent': 'NUK Cafe password check' }, timeout: 5000 })
  }
  catch {
    throw passwordCheckUnavailable()
  }
  const suffixes: string[] = []
  for (const line of body.split(/\r?\n/)) {
    const match = /^([0-9A-F]{35}):(\d+)$/i.exec(line.trim())
    if (!match) {
      if (line.trim()) throw passwordCheckUnavailable()
      continue
    }
    if (Number(match[2]) > 0) suffixes.push(match[1]!.toUpperCase())
  }
  return { suffixes }
}
