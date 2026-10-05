import { readFile } from 'node:fs/promises'
import { beforeAll, describe, expect, inject, it } from 'vitest'
import type { AssistantImportSource } from '#shared/contracts/assistant-import'
import { ASSISTANT_IMPORT_MAX_BYTES } from '#shared/contracts/assistant-import'
import { e2eDatabase } from './support/database'
import { clientHeaders } from './support/client-address'

/** Built app + real auth/SQLite/FS storage; no model calls and no mocked API. */
const host = inject('e2eHost')
const seed = inject('shopSeed')
const base = '/api/c/nuk/admin/assistant/imports'
let cookie: string
let otherCookie: string
let customerCookie: string
let png: Uint8Array<ArrayBuffer>
let pdf: Uint8Array<ArrayBuffer>

async function signIn(person: { email: string, password: string }) {
  const response = await fetch(`${host}/api/auth/sign-in/email`, { method: 'POST', headers: { 'content-type': 'application/json', 'origin': host, ...clientHeaders() }, body: JSON.stringify(person) })
  expect(response.status).toBe(200)
  return response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
}

const api = (path: string, init: RequestInit = {}, session = cookie) => fetch(`${host}${path}`, { ...init, headers: { origin: host, cookie: session, ...init.headers } })
const upload = (mimeType = 'image/png', data = png) => api(base, { method: 'POST', headers: { 'content-type': mimeType, 'x-file-name': encodeURIComponent(mimeType === 'application/pdf' ? 'English menu.pdf' : 'English menu.png') }, body: data })
const source = async () => {
  const response = await upload()
  expect(response.status).toBe(201)
  return await response.json() as AssistantImportSource
}
const discard = (id: string, version = 1) => api(`${base}/${id}/discard`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version }) })

beforeAll(async () => {
  cookie = await signIn(seed.customers.importOwner)
  otherCookie = await signIn(seed.customers.importOtherOwner)
  customerCookie = await signIn(seed.customers.verified)
  png = new Uint8Array(await readFile(new URL('../../server/features/assistant/eval/fixtures/columns-and-sizes.png', import.meta.url)))
  pdf = new Uint8Array(await readFile(new URL('../../server/features/assistant/eval/fixtures/columns-and-sizes-text.pdf', import.meta.url)))
})

describe('private-source routes against the built app', () => {
  it('requires a session, a cafe owner and the normal origin protection', async () => {
    expect((await api(base, {}, '')).status).toBe(401)
    expect((await api(base, {}, customerCookie)).status).toBe(403)
    expect((await api(base, { method: 'POST', headers: { 'origin': 'https://foreign.example', 'content-type': 'image/png' }, body: png })).status).toBe(403)
  })

  it('uploads without a question, resumes metadata and reads protected image/PDF bytes without caching', async () => {
    const image = await source()
    expect(image).not.toHaveProperty('objectKey')
    expect(image).not.toHaveProperty('url')
    expect((await (await api(base)).json()).map((s: AssistantImportSource) => s.id)).toContain(image.id)
    expect(await (await api(`${base}/${image.id}`)).json()).toEqual(image)
    const bytes = await api(`${base}/${image.id}/source`)
    expect(bytes.status).toBe(200)
    expect(bytes.headers.get('cache-control')).toBe('private, no-store')
    expect(bytes.headers.get('x-content-type-options')).toBe('nosniff')
    expect(bytes.headers.get('content-security-policy')).toContain('sandbox')
    expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(png)
    const pdfUpload = await upload('application/pdf', pdf)
    expect(pdfUpload.status).toBe(201)
    const document = await pdfUpload.json() as AssistantImportSource
    const pdfResponse = await api(`${base}/${document.id}/source`)
    expect(pdfResponse.headers.get('content-type')).toBe('application/pdf')
    expect(pdfResponse.headers.get('content-disposition')).toContain('attachment')
    expect(new Uint8Array(await pdfResponse.arrayBuffer())).toEqual(pdf)
    await discard(image.id)
    await discard(document.id)
  })

  it('refuses another cafe for the same owner and another owner in the same cafe', async () => {
    const image = await source()
    const foreign = `/api/c/${seed.secondCafe.slug}/admin/assistant/imports/${image.id}`
    expect((await api(foreign)).status).toBe(404)
    expect((await api(`${foreign}/source`)).status).toBe(404)
    expect((await api(`${base}/${image.id}`, {}, otherCookie)).status).toBe(404)
    expect((await api(`${base}/${image.id}/source`, {}, otherCookie)).status).toBe(404)
    expect((await api(`${base}/${image.id}/discard`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: 1 }) }, otherCookie)).status).toBe(404)
    await discard(image.id)
  })

  it('keeps private source keys outside the public media route', async () => {
    const image = await source()
    const db = e2eDatabase(seed.dbFile)
    try {
      const row = await db.execute({ sql: 'select object_key from assistant_imports where id = ?', args: [image.id] })
      expect((await fetch(`${host}/media/${row.rows[0]!.object_key}`)).status).toBe(404)
    }
    finally { db.close() }
    await discard(image.id)
  })

  it('rejects stale discard versions, then removes metadata and bytes on explicit discard', async () => {
    const image = await source()
    expect((await discard(image.id, 2)).status).toBe(409)
    expect((await api(`${base}/${image.id}/source`)).status).toBe(200)
    expect(await (await discard(image.id)).json()).toEqual({ cleanupPending: false })
    expect((await api(`${base}/${image.id}`)).status).toBe(404)
    expect((await api(`${base}/${image.id}/source`)).status).toBe(404)
  })

  it('hides expired sources even before the storage cleanup task runs', async () => {
    const image = await source()
    const db = e2eDatabase(seed.dbFile)
    try {
      await db.execute({ sql: 'update assistant_imports set expires_at = 0 where id = ?', args: [image.id] })
    }
    finally { db.close() }
    expect((await api(`${base}/${image.id}`)).status).toBe(404)
    expect((await api(`${base}/${image.id}/source`)).status).toBe(404)
  })

  it('rejects type mismatches and over-limit chunked uploads while keeping the server available', async () => {
    expect((await upload('application/pdf', png)).status).toBe(415)
    let chunk = 0
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>({ async pull(c) {
      await new Promise(resolve => setTimeout(resolve, 5))
      if (chunk++ < 8) c.enqueue(new Uint8Array(ASSISTANT_IMPORT_MAX_BYTES / 5))
      else c.close()
    } })
    const init: RequestInit & { duplex: 'half' } = { method: 'POST', headers: { 'content-type': 'image/png', 'x-file-name': 'menu.png' }, body, duplex: 'half' }
    const response = await api(base, init)
    expect(response.status, await response.text()).toBe(413)
    expect((await fetch(`${host}/api/health`)).status).toBe(200)
  })
})
