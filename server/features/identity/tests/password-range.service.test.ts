import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { passwordRangePrefixSchema } from '#shared/contracts/identity'
import type { FetchText } from '#server/features/identity'
import { passwordRange } from '#server/features/identity'

// The new-password checklist's leaked-password ranges (D210), from Have I Been Pwned's range API.

const LEAKED = '1E4C9B93F3F0682250B6CF8331B7EE68FD8'
const OTHER = '011053FD0102E94D6AE2F8B83D76FAF94F6'
const PADDING = '00D4F6E8FA6EECAD2A3AA415EEC418D38EC'

function answering(body: string) {
  const calls: { url: string, headers: Record<string, string> }[] = []
  const fetch: FetchText = async (url, options) => {
    calls.push({ url, headers: options.headers })
    return body
  }
  return { calls, fetch }
}

describe('passwordRange', () => {
  it('asks for the prefix with padding and keeps only the leaked suffixes', async () => {
    const { calls, fetch } = answering(`${LEAKED}:10437277\r\n${OTHER.toLowerCase()}:3\r\n${PADDING}:0\r\n`)
    expect(await passwordRange('5BAA6', fetch)).toEqual({ suffixes: [LEAKED, OTHER] })
    expect(calls).toEqual([{ url: 'https://api.pwnedpasswords.com/range/5BAA6', headers: expect.objectContaining({ 'Add-Padding': 'true' }) }])
  })

  it('answers 503 PASSWORD_CHECK_UNAVAILABLE when the service fails or answers something else', async () => {
    const failing: FetchText = async () => {
      throw new Error('fetch failed')
    }
    await expect(passwordRange('5BAA6', failing)).rejects.toMatchObject({ statusCode: 503, data: { code: 'PASSWORD_CHECK_UNAVAILABLE' } })
    await expect(passwordRange('5BAA6', answering('<html>Cloudflare error</html>').fetch)).rejects.toMatchObject({ statusCode: 503 })
  })
})

describe('passwordRangePrefixSchema', () => {
  it('takes 5 hex characters, in upper case, and nothing else', () => {
    expect(v.parse(passwordRangePrefixSchema, '5baa6')).toBe('5BAA6')
    for (const bad of ['5BAA', '5BAA61', '5BAG6', '../x', '']) expect(v.safeParse(passwordRangePrefixSchema, bad).success).toBe(false)
  })
})
