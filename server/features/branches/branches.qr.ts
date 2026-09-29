import { qrNotConfigured } from './branches.errors'

/**
 * Table QR tokens (D91, docs/server/security.md → Tokens in URLs). A token is rebuilt from the
 * server's secret, the table id and its QR version, so the admin can show a table's QR at any
 * time while the database keeps only the token's SHA-256: a leaked database reveals no working
 * QR. Rotating increments the version, which gives a new token; the old one stops matching.
 * Changing the secret invalidates every printed QR. Tokens are never logged or audited.
 */

export interface QrConfig {
  secret: string
  /** The customer site's origin: a QR links to `<baseUrl>/table/<token>`. */
  baseUrl: string
}

/** The local development secret, used only by the dev server when none is set. */
const DEV_SECRET = 'nuk-dev-only-qr-secret-do-not-use-in-production'

/**
 * The QR settings from runtime config. A deployed build without a secret refuses (the dev server
 * uses a fixed local one), so a forgotten secret can't produce guessable QR codes.
 */
export function qrConfigFrom(options: { secret: string | undefined, siteUrl: string | undefined, requestOrigin: string, dev: boolean }): QrConfig {
  const { secret, siteUrl, requestOrigin, dev } = options
  if (!secret && !dev) throw qrNotConfigured()
  return { secret: secret || DEV_SECRET, baseUrl: (siteUrl || requestOrigin).replace(/\/+$/, '') }
}

const encoder = new TextEncoder()

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/** 128 bits of HMAC-SHA256(secret, "<tableId>:<qrVersion>"), base64url: 22 characters. */
export async function tableToken(secret: string, tableId: string, qrVersion: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${tableId}:${qrVersion}`))
  return base64Url(new Uint8Array(signature).slice(0, 16))
}

/** What the database stores and looks a scanned token up by: SHA-256 of the token, hex. */
export async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** A token's shape; anything else can't be one of ours. */
export const isTokenShaped = (token: string) => /^[\w-]{22}$/.test(token)

export const tableQrUrl = (config: QrConfig, token: string) => `${config.baseUrl}/table/${token}`
