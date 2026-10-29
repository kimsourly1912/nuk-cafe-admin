import { describe, expect, it } from 'vitest'
import { bakongClient, bakongTokenExpiry, readBakongAnswer } from '#server/features/orders/bakong'

// The Bakong Open API's `check_transaction_by_md5` (step 10.15b, D131): what each answer means.

const PAID = {
  responseCode: 0,
  responseMessage: 'Success',
  errorCode: null,
  data: {
    hash: 'bf917e9534cac359',
    fromAccountId: 'customer@abaa',
    toAccountId: 'nukcafe@aclb',
    currency: 'USD',
    amount: 8.75,
    description: null,
    createdDateMs: 1_790_000_000_000,
    acknowledgedDateMs: 1_790_000_002_000,
    externalRef: '100FT36931627892',
  },
}

describe('reading Bakong\'s answer', () => {
  it('paid: the transaction, with the account, currency, amount and references', () => {
    expect(readBakongAnswer(200, PAID)).toEqual({
      kind: 'paid',
      transaction: { hash: 'bf917e9534cac359', fromAccountId: 'customer@abaa', toAccountId: 'nukcafe@aclb', currency: 'USD', amount: 8.75, externalRef: '100FT36931627892', createdAt: new Date(1_790_000_000_000) },
    })
    expect(readBakongAnswer(200, { ...PAID, data: { ...PAID.data, amount: '35900', currency: 'KHR' } })).toMatchObject({ kind: 'paid', transaction: { amount: 35900, currency: 'KHR' } })
  })

  it('not paid yet; the token refused; this server refused; anything else', () => {
    expect(readBakongAnswer(200, { responseCode: 1, responseMessage: 'Transaction could not be found. Please check and try again.', errorCode: 1, data: null })).toEqual({ kind: 'not_found' })
    expect(readBakongAnswer(200, { responseCode: 1, responseMessage: 'Unauthorized', errorCode: 6, data: null })).toMatchObject({ kind: 'unavailable', problem: 'token' })
    expect(readBakongAnswer(401, null)).toMatchObject({ kind: 'unavailable', problem: 'token' })
    expect(readBakongAnswer(403, null)).toMatchObject({ kind: 'unavailable', problem: 'refused' })
    expect(readBakongAnswer(500, null)).toMatchObject({ kind: 'unavailable', problem: 'error', detail: 'Bakong answered 500' })
    expect(readBakongAnswer(200, { responseCode: 1, responseMessage: 'Transaction failed', errorCode: 3, data: null })).toMatchObject({ kind: 'unavailable', problem: 'error' })
    // "Success" without a usable transaction is never taken as paid.
    expect(readBakongAnswer(200, { responseCode: 0, data: { toAccountId: 'nukcafe@aclb', currency: 'USD' } })).toMatchObject({ kind: 'unavailable', problem: 'error' })
  })
})

describe('reading only what Bakong should send (audit S6)', () => {
  const unreadable = { kind: 'unavailable', problem: 'error' }

  it('a "paid" answer whose fields aren\'t what they should be is never taken as paid', () => {
    for (const patch of [
      { toAccountId: { id: 'nukcafe@aclb' } },
      { toAccountId: '  ' },
      { toAccountId: 'x'.repeat(65) },
      { currency: 840 },
      { currency: 'U'.repeat(9) },
      { amount: null },
      { amount: '' },
      { amount: '-8.75' },
      { amount: '8.75 USD' },
      { amount: Number.NaN },
      { amount: -1 },
      { externalRef: { ref: 'x' } },
      { hash: 'h'.repeat(129) },
    ]) {
      expect(readBakongAnswer(200, { ...PAID, data: { ...PAID.data, ...patch } }), JSON.stringify(patch)).toMatchObject(unreadable)
    }
    expect(readBakongAnswer(200, { ...PAID, data: 'paid' })).toMatchObject(unreadable)
  })

  it('an envelope of the wrong shape is an answer it can\'t read', () => {
    expect(readBakongAnswer(200, { ...PAID, responseCode: '0' })).toEqual({ kind: 'unavailable', problem: 'error', detail: 'Bakong\'s answer could not be read' })
    expect(readBakongAnswer(200, { responseCode: 1, errorCode: '1' })).toMatchObject(unreadable)
    expect(readBakongAnswer(200, ['paid'])).toMatchObject(unreadable)
  })

  it('references Bakong leaves empty are left out; text is trimmed; Bakong\'s message is kept short', () => {
    expect(readBakongAnswer(200, { ...PAID, data: { ...PAID.data, hash: '', externalRef: null, fromAccountId: undefined, toAccountId: ' nukcafe@aclb ', createdDateMs: 'soon' } })).toMatchObject({
      kind: 'paid',
      transaction: { hash: null, externalRef: null, fromAccountId: null, toAccountId: 'nukcafe@aclb', createdAt: null },
    })
    const answer = readBakongAnswer(200, { responseCode: 1, errorCode: 3, responseMessage: 'x'.repeat(5000) })
    expect(answer.kind === 'unavailable' && answer.detail.length).toBeLessThan(260)
  })

  it('reads at most 16 KB of the body, and stops reading there', async () => {
    let sent = 0
    let cancelled = false
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 4096
        controller.enqueue(new TextEncoder().encode(' '.repeat(4096)))
      },
      cancel() {
        cancelled = true
      },
    })
    const client = bakongClient({ apiUrl: 'https://bakong.test', token: 't', fetch: async () => new Response(endless) })
    expect(await client.checkByMd5('x')).toMatchObject(unreadable)
    expect(cancelled).toBe(true)
    // The stream fills a chunk or two ahead of the reader; it is cancelled, never read to the end.
    expect(sent).toBeLessThanOrEqual(32 * 1024)
    const exactly = JSON.stringify(PAID).padEnd(16 * 1024, ' ')
    expect(await bakongClient({ apiUrl: 'https://bakong.test', token: 't', fetch: async () => new Response(exactly) }).checkByMd5('x')).toMatchObject({ kind: 'paid' })
  })
})

describe('the client', () => {
  it('posts the MD5 with the token to /v1/check_transaction_by_md5', async () => {
    const sent: { url: string, init: RequestInit }[] = []
    const client = bakongClient({
      apiUrl: 'https://api-bakong.nbc.gov.kh/',
      token: 'token-1',
      fetch: async (url, init) => {
        sent.push({ url: String(url), init: init! })
        return Response.json(PAID)
      },
    })
    expect(await client.checkByMd5('0bac3b35')).toMatchObject({ kind: 'paid' })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.url).toBe('https://api-bakong.nbc.gov.kh/v1/check_transaction_by_md5')
    expect(sent[0]!.init.method).toBe('POST')
    expect(sent[0]!.init.headers).toMatchObject({ 'Authorization': 'Bearer token-1', 'Content-Type': 'application/json' })
    expect(JSON.parse(String(sent[0]!.init.body))).toEqual({ md5: '0bac3b35' })
  })

  it('says Bakong didn\'t answer when the request fails or times out, and reads a body that isn\'t JSON as an error', async () => {
    const down = bakongClient({ apiUrl: 'https://bakong.test', token: 't', fetch: async () => {
      throw new TypeError('fetch failed')
    } })
    expect(await down.checkByMd5('x')).toEqual({ kind: 'unavailable', problem: 'error', detail: 'Bakong did not answer: fetch failed' })
    const slow = bakongClient({ apiUrl: 'https://bakong.test', token: 't', timeout: 10, fetch: (_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason))) })
    expect(await slow.checkByMd5('x')).toMatchObject({ kind: 'unavailable', problem: 'error' })
    const html = bakongClient({ apiUrl: 'https://bakong.test', token: 't', fetch: async () => new Response('<html>Forbidden</html>', { status: 403 }) })
    expect(await html.checkByMd5('x')).toMatchObject({ kind: 'unavailable', problem: 'refused' })
    // A refusal's body is cancelled, not read.
    let cancelled = false
    const page = new ReadableStream<Uint8Array>({ cancel: () => {
      cancelled = true
    } })
    const refused = bakongClient({ apiUrl: 'https://bakong.test', token: 't', fetch: async () => new Response(page, { status: 403 }) })
    expect(await refused.checkByMd5('x')).toMatchObject({ kind: 'unavailable', problem: 'refused' })
    expect(cancelled).toBe(true)
  })
})

describe('the token\'s expiry (D132)', () => {
  /** A JWT shaped like Bakong's (the signature isn't checked). */
  const jwt = (payload: unknown) => `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.c2lnbmF0dXJl`

  it('reads `exp` from the token, in seconds', () => {
    expect(bakongTokenExpiry(jwt({ data: { id: 'x' }, iat: 1_790_000_000, exp: 1_797_776_000 }))).toEqual(new Date(1_797_776_000_000))
    // base64url without padding, with - and _.
    expect(bakongTokenExpiry(` ${jwt({ exp: 1_797_776_000, n: '>>>???' })} `)).toEqual(new Date(1_797_776_000_000))
  })

  it('is null for a token that isn\'t a JWT or carries no usable `exp`', () => {
    expect(bakongTokenExpiry('plain-token')).toBeNull()
    expect(bakongTokenExpiry('a.!!!.c')).toBeNull()
    expect(bakongTokenExpiry(jwt({ iat: 1 }))).toBeNull()
    expect(bakongTokenExpiry(jwt({ exp: '1797776000' }))).toBeNull()
    expect(bakongTokenExpiry(jwt({ exp: -1 }))).toBeNull()
  })
})
