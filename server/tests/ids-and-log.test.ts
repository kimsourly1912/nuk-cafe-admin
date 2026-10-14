import { afterEach, describe, expect, it, vi } from 'vitest'
import { newId } from '#server/utils/ids'
import { log } from '#server/utils/log'
import { createApp, eventHandler, toWebHandler } from 'h3'

describe('newId', () => {
  it('makes UUID v7 ids that sort by creation', () => {
    const ids = Array.from({ length: 50 }, () => newId())
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect([...ids].sort()).toEqual(ids)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('log', () => {
  afterEach(() => vi.restoreAllMocks())

  it('writes one JSON line with the request context and redacts secret-looking fields', () => {
    const write = vi.spyOn(console, 'error').mockImplementation(() => {})
    const event = { context: { requestId: 'req-9' }, method: 'POST', path: '/api/admin/menu/items' } as never
    log('error', 'Unhandled error', { status: 500, password: 'hunter2', sessionToken: 'abc', itemId: 'i1' }, event)
    const line = JSON.parse(write.mock.calls[0]![0] as string)
    expect(line).toEqual({
      level: 'error',
      message: 'Unhandled error',
      requestId: 'req-9',
      method: 'POST',
      path: '/api/admin/menu/items',
      status: 500,
      password: '[redacted]',
      sessionToken: '[redacted]',
      itemId: 'i1',
    })
  })

  it('removes query values from a real H3 request and redacts nested secrets and arrays', async () => {
    const write = vi.spyOn(console, 'error').mockImplementation(() => {})
    const app = createApp().use(eventHandler((event) => {
      log('error', 'Audit probe', { details: { token: 'nested-secret', entries: [{ authorization: 'Bearer hidden', itemId: 'item-1' }] } }, event)
      return { ok: true }
    }))
    await toWebHandler(app)(new Request('https://example.com/api/example?token=query-secret&email=private@example.com'))
    const line = JSON.parse(write.mock.calls[0]![0] as string)
    expect(line.path).toBe('/api/example')
    expect(line.details).toEqual({ token: '[redacted]', entries: [{ authorization: '[redacted]', itemId: 'item-1' }] })
    expect(write.mock.calls[0]![0]).not.toMatch(/nested-secret|query-secret|private@example|Bearer hidden/)
  })

  it('sanitizes exception URLs, credentials and header text while preserving diagnostic locations', () => {
    const write = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('Request failed: https://user:url-password@provider.example/check?token=url-token#secret-fragment Authorization: Bearer header-secret')
    error.stack = 'Error: password=inline-secret\n at check (/workspace/server/provider.ts:12:4)'
    error.cause = new Error('Telegram https://api.telegram.org/bot123:bot-secret/sendMessage')
    log('error', 'Provider failed', { error, cause: 'https://example.com/reset-password/path-secret', detail: 'apiKey="inline-key"', page: '/table/qr-secret' })
    const output = write.mock.calls[0]![0] as string
    expect(output).not.toMatch(/url-password|url-token|secret-fragment|header-secret|inline-secret|bot-secret|path-secret|inline-key|qr-secret/)
    expect(output).toContain('/workspace/server/provider.ts:12:4')
    expect(output).toContain('https://provider.example/check')
  })

  it('bounds recursive fields, accepts bigint/cycles, and preserves trusted context', () => {
    const write = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const circular: Record<string, unknown> = { count: 1n }
    circular.self = circular
    log('warn', 'Bounded', { circular, values: Array.from({ length: 100 }, () => 'x'.repeat(5000)), level: 'fake', path: '/fake' }, { context: { requestId: 'req-1' }, method: 'GET', path: '/api/tables/table-secret?token=query-secret' } as never)
    const line = JSON.parse(write.mock.calls[0]![0] as string)
    expect(line).toMatchObject({ level: 'warn', path: '/api/tables/[redacted]', circular: { count: '1', self: '[circular]' } })
    expect(line.values).toHaveLength(50)
    expect(line.values[0]).toHaveLength(4000)
  })
})
