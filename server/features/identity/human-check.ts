import { APIError } from 'better-auth/api'
import type { HumanCheckAction } from '#shared/utils/human-check'

export interface HumanCheckSettings {
  enabled: boolean
  secret: string
}

const refused = () => new APIError('FORBIDDEN', {
  code: 'HUMAN_CHECK_FAILED',
  message: 'Complete the browser check and try again.',
})
const unavailable = () => new APIError('SERVICE_UNAVAILABLE', {
  code: 'HUMAN_CHECK_UNAVAILABLE',
  message: 'Browser verification is unavailable. Try again shortly.',
})

/** Canonical Siteverify, inside the existing auth hook, before hashing or sending email. */
export async function verifyHumanCheck(input: {
  action: HumanCheckAction
  token: string | null | undefined
  secret: string
  siteUrl: string | undefined
  address?: string | null
}, request: typeof fetch = fetch): Promise<void> {
  if (!input.token || input.token.length > 2048 || !input.token.trim()) throw refused()
  let hostname: string
  try {
    hostname = new URL(input.siteUrl ?? '').hostname
  }
  catch {
    throw unavailable()
  }
  if (!input.secret.trim() || !hostname) throw unavailable()

  let result: unknown
  try {
    const body = new URLSearchParams({ secret: input.secret, response: input.token })
    if (input.address) body.set('remoteip', input.address)
    const response = await request('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error('Verification unavailable')
    result = await response.json()
  }
  catch {
    // Do not attach the upstream exception: it can contain a token, key or response body.
    throw unavailable()
  }
  if (typeof result !== 'object' || result === null
    || !('success' in result) || result.success !== true
    || !('action' in result) || result.action !== input.action
    || !('hostname' in result) || result.hostname !== hostname) throw refused()
  // Cloudflare enforces the five-minute expiry and single use; never cache a successful token.
}
