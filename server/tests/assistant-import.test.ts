import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ASSISTANT_IMPORT_MAX_BYTES } from '#shared/contracts/assistant-import'
import { readAssistantImportFile, requireAssistantImport } from '#server/utils/assistant-import'

function request(body?: ReadableStream<Uint8Array>, headers: Record<string, string | undefined> = {}) {
  const req = new IncomingMessage(new Socket())
  req.method = 'POST'
  req.headers = { 'content-type': 'image/png', 'x-file-name': 'menu.png', ...headers }
  const event = createEvent(req, new ServerResponse(req))
  event._requestBody = body
  return event
}

const permission = vi.fn()
beforeEach(() => {
  permission.mockReset().mockResolvedValue({ userId: 'owner', tenantId: 'cafe', role: 'owner' })
  vi.stubGlobal('useRuntimeConfig', () => ({ ai: { importEnabled: false } }))
  vi.stubGlobal('requirePermission', permission)
})
afterEach(() => vi.unstubAllGlobals())

describe('disabled import request gate', () => {
  it.each([false, '', 'false', undefined, '1', 'true'])('stays hidden unless explicitly enabled (%s)', async (importEnabled) => {
    vi.stubGlobal('useRuntimeConfig', () => ({ ai: { importEnabled } }))
    await expect(requireAssistantImport(request())).rejects.toMatchObject({ statusCode: 404 })
    expect(permission).not.toHaveBeenCalled()
  })
  it.each([true])('uses the existing tenant/owner permission helper when enabled (%s)', async (importEnabled) => {
    vi.stubGlobal('useRuntimeConfig', () => ({ ai: { importEnabled } }))
    const event = request()
    expect(await requireAssistantImport(event)).toMatchObject({ tenantId: 'cafe' })
    expect(permission).toHaveBeenCalledWith(event, { assistant: ['use'] })
  })
  it('propagates permission rejection before the route can read the file', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ ai: { importEnabled: true } }))
    permission.mockRejectedValueOnce(new Error('Permission refused'))
    await expect(requireAssistantImport(request())).rejects.toThrow('Permission refused')
  })
})

describe('bounded raw source body', () => {
  it('reads streamed bytes and decodes the bounded display name, without needing a question', async () => {
    const body = new ReadableStream<Uint8Array>({ start(c) {
      c.enqueue(new Uint8Array([1, 2]))
      c.enqueue(new Uint8Array([3]))
      c.close()
    } })
    expect(await readAssistantImportFile(request(body, { 'x-file-name': 'English%20menu.png' }))).toEqual({ type: 'image/png', fileName: 'English menu.png', data: new Uint8Array([1, 2, 3]) })
  })
  it('rejects advertised over-limit size before consuming the stream', async () => {
    const pull = vi.fn()
    const body = new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 })
    await expect(readAssistantImportFile(request(body, { 'content-length': String(ASSISTANT_IMPORT_MAX_BYTES + 1) }))).rejects.toMatchObject({ statusCode: 413 })
    expect(pull).not.toHaveBeenCalled()
  })
  it('bounds chunked bodies with no Content-Length and cancels on overflow', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ start(c) {
      c.enqueue(new Uint8Array(ASSISTANT_IMPORT_MAX_BYTES))
      c.enqueue(new Uint8Array([1]))
    }, cancel })
    await expect(readAssistantImportFile(request(body))).rejects.toMatchObject({ statusCode: 413 })
    expect(cancel).toHaveBeenCalledOnce()
  })
  it.each([
    { 'content-type': 'text/html' }, { 'content-length': '-1' }, { 'content-length': 'NaN' }, { 'x-file-name': '%broken' },
  ])('rejects invalid source headers before consuming bytes (%s)', async (headers) => {
    const pull = vi.fn()
    const body = new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 })
    await expect(readAssistantImportFile(request(body, headers))).rejects.toMatchObject({ statusCode: expect.any(Number) })
    expect(pull).not.toHaveBeenCalled()
  })
})
