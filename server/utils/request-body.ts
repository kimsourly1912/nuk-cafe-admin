import type { H3Event } from 'h3'
import { getHeader, getRequestWebStream } from 'h3'
import { apiError, ErrorCodes } from './errors'

const tooLarge = () => apiError(413, ErrorCodes.PAYLOAD_TOO_LARGE, 'The request is too large.')

/** Count bytes before parsing. Content-Length is only an early rejection, never the limit. */
export async function readLimitedBody(event: H3Event, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(getHeader(event, 'content-length') ?? 0) > maxBytes) throw tooLarge()
  const chunks: Uint8Array[] = []
  let size = 0
  const append = (chunk: Uint8Array) => {
    size += chunk.byteLength
    if (size > maxBytes) throw tooLarge()
    chunks.push(chunk)
  }

  // Web adapters (including Workers) expose the original stream. The Node listener is handled
  // separately: h3 1's web-stream wrapper has no cancellation hook for its data listener.
  if (event.web?.request || event._requestBody || '__unenv__' in event.node.req) {
    const stream = event.web?.request?.body
      ?? (event._requestBody ? new Response(event._requestBody).body : getRequestWebStream(event))
    const reader = stream?.getReader()
    if (reader) {
      try {
        while (true) {
          const next = await reader.read()
          if (next.done) break
          append(next.value)
        }
      }
      catch (error) {
        await reader.cancel().catch(() => {})
        throw error
      }
      finally {
        reader.releaseLock()
      }
    }
  }
  else {
    const request = event.node.req
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        request.off('data', onData)
        request.off('end', onEnd)
        request.off('error', onError)
        request.off('aborted', onAborted)
      }
      const onError = (error: Error) => {
        cleanup()
        reject(error)
      }
      const onAborted = () => onError(new Error('Request body aborted'))
      const onEnd = () => {
        cleanup()
        resolve()
      }
      const onData = (chunk: Uint8Array) => {
        try {
          append(chunk)
        }
        catch (error) {
          cleanup()
          // Drain without retaining chunks; keep the socket alive long enough to answer 413.
          request.resume()
          reject(error)
        }
      }
      request.on('data', onData).once('end', onEnd).once('error', onError).once('aborted', onAborted)
      if (request.readableEnded) onEnd()
    })
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/** Limit the entire multipart envelope, including unused fields, before FormData parses it. */
export async function readLimitedMultipart(event: H3Event, maxBytes: number) {
  const bytes = await readLimitedBody(event, maxBytes)
  let form: FormData
  try {
    form = await new Response(bytes, { headers: { 'content-type': getHeader(event, 'content-type') ?? '' } }).formData()
  }
  catch {
    throw apiError(400, ErrorCodes.VALIDATION_FAILED, 'The uploaded form is invalid.')
  }
  return Promise.all([...form].map(async ([name, value]) => typeof value === 'string'
    ? { name, data: new TextEncoder().encode(value), filename: undefined, type: undefined }
    : { name, data: new Uint8Array(await value.arrayBuffer()), filename: value.name, type: value.type }))
}
