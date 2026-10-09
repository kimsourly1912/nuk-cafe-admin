/**
 * Each cafe's Bakong token, sealed for the database (step T2d, D148): AES-256-GCM with the server's
 * key `NUXT_BAKONG_ENCRYPTION_KEY` (a Worker secret: 32 random bytes, base64), a new 12-byte IV per
 * seal, and the cafe's id as additional data, so a sealed token copied into another cafe's row
 * doesn't open. Stored as `v1.<iv>.<ciphertext>` (base64url); the `v1` names this scheme, so a later
 * key or scheme can sit beside it. WebCrypto only: the same code runs in the Worker and in Node.
 */

const SCHEME = 'v1'
const KEY_BYTES = 32
const IV_BYTES = 12

/** The key is missing or isn't 32 bytes of base64. */
export class BakongKeyError extends Error {}

/** A sealed token that this key and cafe can't open (another key, another cafe, or altered). */
export class BakongSealError extends Error {}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** The AES key from `NUXT_BAKONG_ENCRYPTION_KEY` (base64 or base64url of 32 bytes). */
export async function importBakongKey(secret: string): Promise<CryptoKey> {
  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = fromBase64(secret.trim())
  }
  catch {
    throw new BakongKeyError('NUXT_BAKONG_ENCRYPTION_KEY isn\'t base64')
  }
  if (bytes.length !== KEY_BYTES) throw new BakongKeyError(`NUXT_BAKONG_ENCRYPTION_KEY must be ${KEY_BYTES} bytes (it is ${bytes.length})`)
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

const additionalData = (tenantId: string) => new TextEncoder().encode(`bakong-token:${tenantId}`)

/** Seals a cafe's token for its row. */
export async function sealBakongToken(key: CryptoKey, tenantId: string, token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: additionalData(tenantId) }, key, new TextEncoder().encode(token))
  return `${SCHEME}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(sealed))}`
}

/** Opens a cafe's sealed token; `BakongSealError` when this key and cafe can't. */
export async function openBakongToken(key: CryptoKey, tenantId: string, sealed: string): Promise<string> {
  const [scheme, iv, data] = sealed.split('.')
  if (scheme !== SCHEME || !iv || !data) throw new BakongSealError('Not a sealed Bakong token')
  try {
    const opened = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv), additionalData: additionalData(tenantId) }, key, fromBase64(data))
    return new TextDecoder().decode(opened)
  }
  catch {
    throw new BakongSealError('The sealed Bakong token doesn\'t open with this key for this cafe')
  }
}
