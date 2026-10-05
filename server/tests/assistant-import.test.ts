import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ASSISTANT_IMPORT_MAX_BYTES, extractAssistantImportSchema } from '#shared/contracts/assistant-import'
import { assistantImportStatus, assistantImportModel, readAssistantImportFile, readAssistantPdfPage, readAssistantReviewBody, requireAssistantImport } from '#server/utils/assistant-import'

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

describe('bounded raw PDF page body', () => {
  it('reads one raw PNG and source version with no Content-Length', async () => {
    const body = new ReadableStream<Uint8Array>({ start(c) {
      c.enqueue(new Uint8Array([1, 2]))
      c.close()
    } })
    expect(await readAssistantPdfPage(request(body, { 'x-source-version': '3' }))).toEqual({ version: 3, bytes: new Uint8Array([1, 2]) })
  })
  it.each([{ 'x-source-version': '' }, { 'x-source-version': '0' }, { 'x-source-version': '01' }, { 'x-source-version': '1e2' }, { 'x-source-version': '9007199254740993' }, { 'content-type': 'image/jpeg', 'x-source-version': '1' }, { 'content-length': 'invalid', 'x-source-version': '1' }])('refuses invalid headers before reading the page (%j)', async (headers) => {
    const pull = vi.fn()
    const body = new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 })
    await expect(readAssistantPdfPage(request(body, headers))).rejects.toMatchObject({ statusCode: expect.any(Number) })
    expect(pull).not.toHaveBeenCalled()
  })
  it('rejects oversized length before reading and over-limit chunked bytes with cancellation', async () => {
    const pull = vi.fn()
    await expect(readAssistantPdfPage(request(new ReadableStream({ pull }, { highWaterMark: 0 }), { 'x-source-version': '1', 'content-length': String(2 * 1024 * 1024 + 1) }))).rejects.toMatchObject({ statusCode: 413 })
    expect(pull).not.toHaveBeenCalled()
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ start(c) {
      c.enqueue(new Uint8Array(2 * 1024 * 1024 + 1))
    }, cancel })
    await expect(readAssistantPdfPage(request(body, { 'x-source-version': '1' }))).rejects.toMatchObject({ statusCode: 413 })
    expect(cancel).toHaveBeenCalledOnce()
  })
})

describe('review commands and binding glue', () => {
  it('uses the import model independently from the help model/provider/key', () => {
    const event = request()
    const run = vi.fn()
    event.context.cloudflare = { env: { AI: { run } as never } }
    vi.stubGlobal('useRuntimeConfig', () => ({ ai: { importModel: '@cf/google/gemma-4-26b-a4b-it', dailyLimit: 2, provider: 'openai', model: 'legacy', apiKey: 'legacy-key' } }))
    expect(assistantImportModel(event).settings).toMatchObject({ provider: 'cloudflare', model: '@cf/google/gemma-4-26b-a4b-it', apiKey: '', dailyLimit: 2 })
    expect(run).not.toHaveBeenCalled()
  })
  it('refuses missing binding/configuration without a model call', () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ ai: { importModel: '@cf/google/gemma-4-26b-a4b-it' } }))
    expect(() => assistantImportModel(request())).toThrow()
  })
  it('reads strict JSON commands with no Content-Length', async () => {
    const stream = new ReadableStream<Uint8Array>({ start(c) {
      c.enqueue(new TextEncoder().encode('{"version":3}'))
      c.close()
    } })
    expect(await readAssistantReviewBody(request(stream), extractAssistantImportSchema)).toEqual({ version: 3 })
  })
  it('rejects an actual over-limit chunked JSON command and cancels its stream', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ start(c) {
      c.enqueue(new Uint8Array(64 * 1024 + 1))
    }, cancel })
    await expect(readAssistantReviewBody(request(stream), extractAssistantImportSchema)).rejects.toMatchObject({ statusCode: 413 })
    expect(cancel).toHaveBeenCalledOnce()
  })
  it.each(['not JSON', '{"version":1,"tenantId":"foreign"}', '{"version":0}'])('refuses invalid/unknown fields (%s)', async (body) => {
    const stream = new ReadableStream<Uint8Array>({ start(c) {
      c.enqueue(new TextEncoder().encode(body))
      c.close()
    } })
    await expect(readAssistantReviewBody(request(stream), extractAssistantImportSchema)).rejects.toMatchObject({ statusCode: 400 })
  })
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
  it('requires both assistant use and menu write for the explicit draft command', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ ai: { importEnabled: true } }))
    const event = request()
    await requireAssistantImport(event, { menuWrite: true })
    expect(permission).toHaveBeenCalledWith(event, { assistant: ['use'], menu: ['write'] })
  })
  it('keeps draft creation hidden before checking its permissions when imports are disabled', async () => {
    await expect(requireAssistantImport(request(), { menuWrite: true })).rejects.toMatchObject({ statusCode: 404 })
    expect(permission).not.toHaveBeenCalled()
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

describe('import entry availability', () => {
  it('requires both permissions even when disabled and returns no settings or source data', async () => {
    const event = request()
    expect(await assistantImportStatus(event)).toEqual({ enabled: false, pdfProcessing: false })
    expect(permission).toHaveBeenCalledWith(event, { assistant: ['use'], menu: ['write'] })
  })
  it('is independent of help enablement and requires an actual boolean switch', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ ai: { importEnabled: true } }))
    expect(await assistantImportStatus(request())).toEqual({ enabled: true, pdfProcessing: false })
    vi.stubGlobal('useRuntimeConfig', () => ({ ai: { importEnabled: 'true' } }))
    expect((await assistantImportStatus(request())).enabled).toBe(false)
  })
  it('does not reveal availability to a caller without permission', async () => {
    permission.mockRejectedValue(new Error('Forbidden'))
    await expect(assistantImportStatus(request())).rejects.toThrow('Forbidden')
  })
})
