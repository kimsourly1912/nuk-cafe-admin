import * as v from 'valibot'

/**
 * The Bakong Open API (step 10.15b, D131): the National Bank of Cambodia's API that says whether a
 * dynamic KHQR was paid, asked by the QR text's MD5 (`check_transaction_by_md5`). Bakong sends no
 * webhooks: the payee asks. The token is free, from Bakong's developer portal, and lasts 90 days.
 *
 * Bakong's answers (its *Open API Document*, and checked against what integrations see):
 * - `responseCode: 0` with `data`: paid; `data` names the receiving account, the currency, the amount
 *   and the bank's references.
 * - `responseCode: 1`, `errorCode: 1`: no such transaction yet (not paid).
 * - `errorCode: 6`, or HTTP 401: the token isn't accepted (expired or wrong).
 * - HTTP 403: Bakong refuses this server; in production it reportedly answers only servers in
 *   Cambodia. Then the cashier confirms by hand, as before.
 */

export interface BakongClientOptions {
  /** `NUXT_BAKONG_API_URL`, `https://api-bakong.nbc.gov.kh` unless a relay stands in front of it. */
  apiUrl: string
  /** The cafe's own token, opened from its sealed row for this request (T2d, D148). */
  token: string
  fetch?: typeof fetch
  /** How long to wait for Bakong (ms). */
  timeout?: number
}

export interface BakongTransaction {
  /** Bakong's transaction hash, when it gives one. */
  hash: string | null
  fromAccountId: string | null
  toAccountId: string
  currency: string
  amount: number
  /** The bank's own reference, when Bakong gives one. */
  externalRef: string | null
  createdAt: Date | null
}

/** Why Bakong couldn't say: the token, a saved token this server's key can't open (D148), Bakong refusing this server, or anything else. */
export type BakongProblem = 'token' | 'key' | 'refused' | 'error'

export type BakongAnswer
  = | { kind: 'paid', transaction: BakongTransaction }
    | { kind: 'not_found' }
    | { kind: 'unavailable', problem: BakongProblem, detail: string }

export interface BakongClient {
  checkByMd5: (md5: string) => Promise<BakongAnswer>
}

/** Bakong's answers are a few hundred bytes: a longer body is not an answer to read. */
const ANSWER_MAX_BYTES = 16 * 1024

/** The answer's envelope. Anything else (a field of the wrong type) is an answer we can't read. */
const answerSchema = v.object({
  responseCode: v.optional(v.number()),
  responseMessage: v.optional(v.nullable(v.string())),
  errorCode: v.optional(v.nullable(v.number())),
  data: v.optional(v.unknown()),
})

/** Text Bakong may leave out; empty counts as left out. */
const optionalText = (max: number) =>
  v.optional(v.pipe(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(max))), v.transform(text => text || null)), null)

/**
 * A paid transaction: only these fields decide that money arrived and where, so each is checked
 * (an object for an account, an amount that isn't a number) before anything reads it (audit S6).
 */
const transactionSchema = v.object({
  hash: optionalText(128),
  fromAccountId: optionalText(64),
  toAccountId: v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(64)),
  currency: v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(8)),
  amount: v.pipe(v.union([v.number(), v.pipe(v.string(), v.regex(/^\d+(\.\d+)?$/), v.transform(Number))]), v.finite(), v.minValue(0)),
  externalRef: optionalText(128),
  createdDateMs: v.optional(v.unknown()),
})

const DEFAULT_TIMEOUT = 8_000

/** Bakong's words in a problem's detail, kept short: they reach the logs and the Payments page. */
const shortMessage = (message: string | null | undefined) => (message ?? '').slice(0, 200)

/** Reads one answer of `check_transaction_by_md5` (pure, for the tests). `body` is the parsed JSON, `null` when there was none. */
export function readBakongAnswer(status: number, body: unknown): BakongAnswer {
  if (status === 401) return { kind: 'unavailable', problem: 'token', detail: 'Bakong did not accept the token (401)' }
  if (status === 403) return { kind: 'unavailable', problem: 'refused', detail: 'Bakong refused this server (403)' }
  if (status < 200 || status >= 300 || !body) return { kind: 'unavailable', problem: 'error', detail: `Bakong answered ${status}` }
  const answer = v.safeParse(answerSchema, body)
  if (!answer.success) return { kind: 'unavailable', problem: 'error', detail: 'Bakong\'s answer could not be read' }
  const { responseCode, errorCode, data } = answer.output
  const message = shortMessage(answer.output.responseMessage)
  if (errorCode === 6) return { kind: 'unavailable', problem: 'token', detail: `Bakong did not accept the token: ${message}` }
  if (responseCode === 1 && errorCode === 1) return { kind: 'not_found' }
  const transaction = responseCode === 0 ? v.safeParse(transactionSchema, data) : undefined
  if (transaction?.success) {
    const paid = transaction.output
    return {
      kind: 'paid',
      transaction: {
        hash: paid.hash,
        fromAccountId: paid.fromAccountId,
        toAccountId: paid.toAccountId,
        currency: paid.currency,
        amount: paid.amount,
        externalRef: paid.externalRef,
        createdAt: typeof paid.createdDateMs === 'number' && Number.isFinite(paid.createdDateMs) ? new Date(paid.createdDateMs) : null,
      },
    }
  }
  return { kind: 'unavailable', problem: 'error', detail: `Bakong answered code ${responseCode ?? '?'}/${errorCode ?? '?'}: ${message}` }
}

/**
 * The answer's JSON, counting the bytes as they arrive: never more than `ANSWER_MAX_BYTES` read
 * (a stand-in in front of Bakong could send anything). `null` for a body too long, cut off or not JSON.
 */
async function readAnswerBody(response: Response): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > ANSWER_MAX_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(next.value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  }
  catch {
    return null
  }
  finally {
    reader.releaseLock()
  }
}

export function bakongClient(options: BakongClientOptions): BakongClient {
  const send = options.fetch ?? fetch
  const url = `${options.apiUrl.replace(/\/+$/, '')}/v1/check_transaction_by_md5`

  async function checkByMd5(md5: string): Promise<BakongAnswer> {
    let response: Response
    try {
      response = await send(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${options.token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ md5 }),
        signal: AbortSignal.timeout(options.timeout ?? DEFAULT_TIMEOUT),
      })
    }
    catch (error) {
      return { kind: 'unavailable', problem: 'error', detail: `Bakong did not answer: ${error instanceof Error ? error.message : String(error)}` }
    }
    // A refusal or error is read from its status alone: its body (often a proxy's HTML page) isn't read.
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      return readBakongAnswer(response.status, null)
    }
    return readBakongAnswer(response.status, await readAnswerBody(response))
  }

  return { checkByMd5 }
}

/**
 * When the token stops working (step 10.16, D132): Bakong's tokens are JWTs whose payload carries
 * `exp` (seconds). Read only, never verified: it's our own secret, and the date only drives the
 * Payments page and the reminders. `null` for anything that isn't a JWT with an `exp`.
 */
export function bakongTokenExpiry(token: string): Date | null {
  const payload = token.trim().split('.')[1]
  if (!payload) return null
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=')
    const exp = (JSON.parse(atob(base64)) as { exp?: unknown }).exp
    return typeof exp === 'number' && Number.isFinite(exp) && exp > 0 ? new Date(exp * 1000) : null
  }
  catch {
    return null
  }
}
