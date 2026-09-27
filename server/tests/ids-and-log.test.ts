import { afterEach, describe, expect, it, vi } from 'vitest'
import { newId } from '../utils/ids'
import { log } from '../utils/log'

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
})
