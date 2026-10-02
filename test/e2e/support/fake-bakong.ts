import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * A stand-in for the Bakong Open API for the e2e server (step 10.15b, D131): the server is started
 * with `NUXT_BAKONG_API_URL` pointing here and `NUXT_BAKONG_TOKEN` = `FAKE_BAKONG_TOKEN`, so the
 * counter's automatic check runs through the real server and its real Bakong client.
 *
 * - `POST /v1/check_transaction_by_md5` `{ md5 }`: 401 without the token; the transaction a test
 *   put there, or Bakong's "not found".
 * - `POST /__test/transactions` `{ md5, transaction }`: a test says a QR was paid (the transaction
 *   as Bakong's `data`).
 */
export const FAKE_BAKONG_TOKEN = 'e2e-bakong-token'

export async function startFakeBakong(): Promise<{ url: string, close: () => void }> {
  const transactions = new Map<string, unknown>()

  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const chunk of request) raw += chunk
    const body = raw ? JSON.parse(raw) as Record<string, unknown> : {}
    const send = (status: number, json: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(json))
    }

    if (request.method === 'POST' && request.url === '/__test/transactions') {
      transactions.set(String(body.md5), body.transaction)
      return send(200, { ok: true })
    }
    if (request.method === 'POST' && request.url === '/v1/check_transaction_by_md5') {
      if (request.headers.authorization !== `Bearer ${FAKE_BAKONG_TOKEN}`) return send(401, { responseCode: 1, responseMessage: 'Unauthorized', errorCode: 6, data: null })
      const data = transactions.get(String(body.md5))
      return data
        ? send(200, { responseCode: 0, responseMessage: 'Success', errorCode: null, data })
        : send(200, { responseCode: 1, responseMessage: 'Transaction could not be found. Please check and try again.', errorCode: 1, data: null })
    }
    send(404, { error: 'not found' })
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() }
}
