import type { H3Event } from 'h3'
import { getHeader, getRequestWebStream, setHeader } from 'h3'
import type * as v from 'valibot'
import { assistantOff, importSettingsFrom, languageModel } from '#server/features/assistant'
import { ASSISTANT_IMPORT_MAX_BYTES, ASSISTANT_IMPORT_TYPES } from '#shared/contracts/assistant-import'
import { apiError } from './errors'
import { parseInput } from './validation'

/** Separate from help enablement/model settings: no inference or API key is needed for sources. */
export async function requireAssistantImport(event: H3Event) {
  const enabled = useRuntimeConfig(event).ai.importEnabled
  if (enabled !== true) throw assistantOff()
  return requirePermission(event, { assistant: ['use'] })
}

/** Raw file body via H3 1's supported stream API, bounded even without Content-Length. */
export async function readAssistantImportFile(event: H3Event) {
  const type = getHeader(event, 'content-type') ?? ''
  if (!(ASSISTANT_IMPORT_TYPES as readonly string[]).includes(type)) throw apiError(415, 'UNSUPPORTED_MEDIA', 'Choose a JPEG, PNG, WebP or PDF.')
  const length = getHeader(event, 'content-length')
  if (length !== undefined && !/^\d+$/.test(length)) throw apiError(400, 'VALIDATION_FAILED', 'The file length is invalid.')
  if (length !== undefined && Number(length) > ASSISTANT_IMPORT_MAX_BYTES) throw apiError(413, 'PAYLOAD_TOO_LARGE', 'Choose a file no larger than 5 MB.')
  let fileName: string
  try {
    fileName = decodeURIComponent(getHeader(event, 'x-file-name') ?? '')
  }
  catch { throw apiError(400, 'VALIDATION_FAILED', 'The file name is invalid.') }
  return { type, fileName, data: await readBoundedBody(event, ASSISTANT_IMPORT_MAX_BYTES, 'Choose a file no larger than 5 MB.') }
}

/** Shared byte cap for raw sources and JSON review commands, including chunked requests. */
async function readBoundedBody(event: H3Event, maxBytes: number, message: string) {
  const length = getHeader(event, 'content-length')
  if (length !== undefined && Number(length) > maxBytes) throw apiError(413, 'PAYLOAD_TOO_LARGE', message)
  const stream = getRequestWebStream(event)
  if (!stream) throw apiError(400, 'VALIDATION_FAILED', 'Choose a file to upload.')
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = new Uint8Array(value)
      size += chunk.byteLength
      if (size > maxBytes) {
        if (!event.web && !event._requestBody) {
          // H3 1's Node bridge has no upstream cancel handler: cancelling its reader while
          // data is still arriving makes the bridge enqueue into a closed controller.
          // Pause input, send the 413, then close the request after the response is flushed.
          event.node.req.pause()
          setHeader(event, 'Connection', 'close')
          event.node.res.once('finish', () => event.node.req.destroy())
        }
        else { await reader.cancel().catch(() => {}) }
        throw apiError(413, 'PAYLOAD_TOO_LARGE', message)
      }
      chunks.push(chunk)
    }
  }
  finally { reader.releaseLock() }
  const data = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.length
  }
  return data
}

/** Current binding path for Nitro 2; callers must already have passed requireAssistantImport. */
export function assistantImportModel(event: H3Event) {
  const settings = importSettingsFrom(useRuntimeConfig(event).ai)
  return { settings, model: languageModel(settings, event.context.cloudflare?.env?.AI) }
}

export async function readAssistantReviewBody<T extends v.GenericSchema>(event: H3Event, schema: T): Promise<v.InferOutput<T>> {
  const bytes = await readBoundedBody(event, 64 * 1024, 'The review command is too large.')
  let body: unknown
  try {
    body = JSON.parse(new TextDecoder().decode(bytes))
  }
  catch { throw apiError(400, 'VALIDATION_FAILED', 'The request body is not valid JSON.') }
  return parseInput(schema, body)
}
