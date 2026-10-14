import { describe, expect, it } from 'vitest'
import { PHOTO_UPLOAD_MAX_BYTES, IMAGE_MAX_BYTES } from '#shared/contracts/media'
import { boundedWorkerRequest, workerBodyLimit } from '#server/utils/worker-body'

describe('Cloudflare entry body limits', () => {
  it('bounds all APIs, with only the two multipart upload exceptions', () => {
    expect(workerBodyLimit('/api/auth/sign-in/email')).toBe(64 * 1024)
    expect(workerBodyLimit('/api/c/cafe/admin/media/photos')).toBe(PHOTO_UPLOAD_MAX_BYTES)
    expect(workerBodyLimit('/api/c/cafe/admin/media')).toBe(IMAGE_MAX_BYTES + 64 * 1024)
    expect(workerBodyLimit('/api/c/cafe/admin/media/photos/id/source')).toBe(64 * 1024)
    expect(workerBodyLimit('/c/cafe')).toBeUndefined()
  })

  it('rejects and cancels an oversized stream before Nitro can receive it', async () => {
    let reads = 0
    let canceled = false
    const body = new ReadableStream({
      pull(controller) {
        if (reads === 8) {
          controller.close()
          return
        }
        reads++
        controller.enqueue(new Uint8Array(64 * 1024))
      },
      cancel() { canceled = true },
    })
    const bounded = await boundedWorkerRequest(new Request('https://cafe.test/api/client-errors', { method: 'POST', body, duplex: 'half' } as RequestInit))
    expect(bounded).toBeInstanceOf(Response)
    const response = bounded as Response
    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ data: { code: 'PAYLOAD_TOO_LARGE' } })
    expect(canceled).toBe(true)
    expect(reads).toBeLessThanOrEqual(3)
  })

  it('forwards valid bytes and authentication headers unchanged', async () => {
    const request = new Request('https://cafe.test/api/auth/sign-in/email', {
      method: 'POST', headers: { cookie: 'session=test', origin: 'https://cafe.test' }, body: '{"name":"ok"}',
    })
    const bounded = await boundedWorkerRequest(request) as Request
    expect(bounded.headers.get('cookie')).toBe('session=test')
    expect(bounded.headers.get('origin')).toBe('https://cafe.test')
    expect(await bounded.text()).toBe('{"name":"ok"}')
  })
})
