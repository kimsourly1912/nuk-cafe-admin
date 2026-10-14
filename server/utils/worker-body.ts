import { IMAGE_MAX_BYTES, PHOTO_UPLOAD_MAX_BYTES } from '#shared/contracts/media'

/** Nitro 2's Cloudflare adapter buffers bodies before route handlers. Enforce the cap first. */
export function workerBodyLimit(path: string): number | undefined {
  if (!path.startsWith('/api/')) return undefined
  if (/^\/api\/c\/[^/]+\/admin\/media\/photos\/?$/.test(path)) return PHOTO_UPLOAD_MAX_BYTES
  if (/^\/api\/c\/[^/]+\/admin\/media\/?$/.test(path)) return IMAGE_MAX_BYTES + 64 * 1024
  return 64 * 1024
}

export async function boundedWorkerRequest(request: Request): Promise<Request | Response> {
  const maxBytes = workerBodyLimit(new URL(request.url).pathname)
  if (maxBytes === undefined || !request.body) return request
  const refuse = () => Response.json({ statusCode: 413, message: 'The request is too large.', data: { code: 'PAYLOAD_TOO_LARGE' } }, {
    status: 413, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  })
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) {
    await request.body.cancel().catch(() => {})
    return refuse()
  }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel().catch(() => {})
        return refuse()
      }
      chunks.push(value)
    }
  }
  finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new Request(request, { body: bytes })
}
