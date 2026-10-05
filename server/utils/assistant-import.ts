import type { H3Event } from 'h3'
import { getHeader, getRequestWebStream, setHeader } from 'h3'
import { assistantOff } from '#server/features/assistant'
import { ASSISTANT_IMPORT_MAX_BYTES, ASSISTANT_IMPORT_TYPES } from '#shared/contracts/assistant-import'
import { apiError } from './errors'

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
      if (size > ASSISTANT_IMPORT_MAX_BYTES) {
        if (!event.web && !event._requestBody) {
          // H3 1's Node bridge has no upstream cancel handler: cancelling its reader while
          // data is still arriving makes the bridge enqueue into a closed controller.
          // Pause input, send the 413, then close the request after the response is flushed.
          event.node.req.pause()
          setHeader(event, 'Connection', 'close')
          event.node.res.once('finish', () => event.node.req.destroy())
        }
        else { await reader.cancel().catch(() => {}) }
        throw apiError(413, 'PAYLOAD_TOO_LARGE', 'Choose a file no larger than 5 MB.')
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
  return { type, fileName, data }
}
