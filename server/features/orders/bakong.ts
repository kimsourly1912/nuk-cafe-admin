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
  /** `NUXT_BAKONG_TOKEN`, a Worker secret. */
  token: string
  fetch?: typeof fetch
  /** How long to wait for Bakong (ms). */
  timeout?: number
}

export interface BakongTransaction {
  hash: string
  fromAccountId: string | null
  toAccountId: string
  currency: string
  amount: number
  /** The bank's own reference, when Bakong gives one. */
  externalRef: string | null
  createdAt: Date | null
}

/** Why Bakong couldn't say: the token, Bakong refusing this server, or anything else. */
export type BakongProblem = 'token' | 'refused' | 'error'

export type BakongAnswer
  = | { kind: 'paid', transaction: BakongTransaction }
    | { kind: 'not_found' }
    | { kind: 'unavailable', problem: BakongProblem, detail: string }

export interface BakongClient {
  checkByMd5: (md5: string) => Promise<BakongAnswer>
}

interface BakongBody {
  responseCode?: number
  responseMessage?: string | null
  errorCode?: number | null
  data?: {
    hash?: string
    fromAccountId?: string | null
    toAccountId?: string
    currency?: string
    amount?: number | string
    externalRef?: string | null
    createdDateMs?: number | null
  } | null
}

const DEFAULT_TIMEOUT = 8_000

/** Reads one answer of `check_transaction_by_md5` (pure, for the tests). */
export function readBakongAnswer(status: number, body: BakongBody | null): BakongAnswer {
  if (status === 401) return { kind: 'unavailable', problem: 'token', detail: 'Bakong did not accept the token (401)' }
  if (status === 403) return { kind: 'unavailable', problem: 'refused', detail: 'Bakong refused this server (403)' }
  if (status < 200 || status >= 300 || !body) return { kind: 'unavailable', problem: 'error', detail: `Bakong answered ${status}` }
  const message = body.responseMessage ?? ''
  if (body.errorCode === 6) return { kind: 'unavailable', problem: 'token', detail: `Bakong did not accept the token: ${message}` }
  if (body.responseCode === 1 && body.errorCode === 1) return { kind: 'not_found' }
  const data = body.data
  const amount = Number(data?.amount)
  if (body.responseCode === 0 && data?.toAccountId && data.currency && Number.isFinite(amount)) {
    return {
      kind: 'paid',
      transaction: {
        hash: data.hash ?? '',
        fromAccountId: data.fromAccountId ?? null,
        toAccountId: data.toAccountId,
        currency: data.currency,
        amount,
        externalRef: data.externalRef ?? null,
        createdAt: typeof data.createdDateMs === 'number' ? new Date(data.createdDateMs) : null,
      },
    }
  }
  return { kind: 'unavailable', problem: 'error', detail: `Bakong answered code ${body.responseCode ?? '?'}/${body.errorCode ?? '?'}: ${message}` }
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
    const body = await response.json().catch(() => null) as BakongBody | null
    return readBakongAnswer(response.status, body)
  }

  return { checkByMd5 }
}
