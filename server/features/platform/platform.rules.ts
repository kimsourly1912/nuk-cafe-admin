/** Pure platform rules (no I/O). */

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

/** Delivery attempts before a message is marked `failed` (and logged as an error). */
export const OUTBOX_MAX_ATTEMPTS = 8
/** How long a delivery run holds a message: longer than any handler may take. */
export const OUTBOX_CLAIM_MS = 2 * 60 * 1000

/** Delay before retry `attempt` (1-based): 1, 2, 4 … minutes, at most 6 hours. */
export function retryDelayMs(attempt: number): number {
  return Math.min(2 ** Math.max(0, attempt - 1) * 60_000, 6 * 60 * 60 * 1000)
}

/** JSON with object keys sorted, so the same request always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/** SHA-256 (hex) of the canonical request: "same key, same request?" */
export async function hashRequest(request: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(request)))
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Error text stored on a message: short, one line (never a stack or a payload). */
export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\s+/g, ' ').slice(0, 500)
}
