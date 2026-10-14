import { createServer, request } from 'node:http'
import { createApp, eventHandler, toNodeListener, toWebHandler } from 'h3'
import type { H3Event } from 'h3'
import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { readLimitedMultipart } from '#server/utils/request-body'
import { MAX_JSON_BYTES, readValidBody } from '#server/utils/validation'

const json = (event: H3Event) => readValidBody(event, v.strictObject({ name: v.pipe(v.string(), v.trim(), v.maxLength(5)) }))

async function send(body: string, options: { multipart?: boolean, length?: boolean } = {}) {
  const app = createApp().use(eventHandler(async event => options.multipart ? { parts: (await readLimitedMultipart(event, 128)).length } : json(event)))
  const server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address() as { port: number }
    return await new Promise<{ status: number, body: string }>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, method: 'POST', headers: {
        'content-type': options.multipart ? 'multipart/form-data; boundary=audit' : 'application/json',
        ...(options.length ? { 'content-length': Buffer.byteLength(body) } : { 'transfer-encoding': 'chunked' }),
      } }, (res) => {
        let answer = ''
        res.on('data', chunk => answer += chunk)
        res.on('end', () => resolve({ status: res.statusCode!, body: answer }))
      })
      req.on('error', reject)
      req.write(body)
      req.end()
    })
  }
  finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

describe('received request bytes', () => {
  it.each([false, true])('rejects oversized JSON before trimming (Content-Length: %s)', async (length) => {
    expect((await send(JSON.stringify({ name: ' '.repeat(MAX_JSON_BYTES * 2) + 'ok' }), { length })).status).toBe(413)
  })

  it('accepts exactly the byte limit, rejects multibyte overflow, and preserves invalid-JSON errors', async () => {
    const overhead = Buffer.byteLength(JSON.stringify({ name: 'ok' }))
    expect(await send(JSON.stringify({ name: ' '.repeat(MAX_JSON_BYTES - overhead) + 'ok' }))).toEqual({ status: 200, body: '{"name":"ok"}' })
    expect((await send(JSON.stringify({ name: '\u3000'.repeat(MAX_JSON_BYTES / 2) + 'ok' }))).status).toBe(413)
    expect((await send('{invalid')).status).toBe(400)
    expect((await send(JSON.stringify({ name: 'ok' }))).status).toBe(200)
  })

  it('counts unused multipart fields and accepts valid forms', async () => {
    const multipart = (value: string) => `--audit\r\nContent-Disposition: form-data; name="unused"\r\n\r\n${value}\r\n--audit--\r\n`
    expect((await send(multipart('x'.repeat(256)), { multipart: true })).status).toBe(413)
    expect(await send(multipart('ok'), { multipart: true })).toEqual({ status: 200, body: '{"parts":1}' })
  })

  it('limits and cancels the original Web request stream without a length header', async () => {
    let canceled = false
    let reads = 0
    const stream = new ReadableStream({
      pull(controller) {
        if (reads++ === 4) controller.close()
        else controller.enqueue(new Uint8Array(MAX_JSON_BYTES + 1))
      },
      cancel() { canceled = true },
    })
    const handler = toWebHandler(createApp().use(eventHandler(json)))
    const response = await handler(new Request('https://example.test/', {
      method: 'POST', body: stream, duplex: 'half',
    } as RequestInit))
    expect(response.status).toBe(413)
    expect(canceled).toBe(true)
  })
})
