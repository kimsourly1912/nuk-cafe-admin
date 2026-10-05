import { readFile } from 'node:fs/promises'
import { beforeAll, describe, expect, inject, it } from 'vitest'
import type { AssistantImportDraft, AssistantImportSource } from '#shared/contracts/assistant-import'
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
  it('exposes owner import availability independently of the unconfigured help/extraction model', async () => {
    expect(await (await api('/api/c/nuk/admin/assistant/import-status')).json()).toEqual({ enabled: true, pdfProcessing: false })
    expect((await api('/api/c/nuk/admin/assistant/import-status', {}, '')).status).toBe(401)
    expect((await api('/api/c/nuk/admin/assistant/import-status', {}, customerCookie)).status).toBe(403)
  })

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

/** Seeded review state substitutes for inference; these checks exercise real API/auth/DB writes. */
const reviewRow = () => ({ id: crypto.randomUUID(), selected: true,
  source: { name: 'Coffee', description: null, category: 'Drinks', prices: [{ label: null, amount: '2.50', currency: 'USD', evidence: '$2.50' }], flags: [] },
  draft: { name: 'Coffee', description: '', categoryId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 250, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] } })
const jsonCommand = (path: string, method: 'POST' | 'PATCH', body: unknown, session = cookie) => api(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, session)
const readySource = async () => {
  const image = await source()
  const row = reviewRow()
  const db = e2eDatabase(seed.dbFile)
  try {
    await db.execute({ sql: 'update assistant_imports set review_state = \'ready\', review_rows = ?, version = 3 where id = ?', args: [JSON.stringify([row]), image.id] })
  }
  finally { db.close() }
  return { image, row }
}

describe('private-review routes against the built app, with seeded extraction state', () => {
  it('resumes a source that has not yet been processed', async () => {
    const image = await source()
    const response = await api(`${base}/${image.id}/review`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.json()).toMatchObject({ state: 'none', rows: [], error: null, source: { version: 1 } })
    await discard(image.id)
  })
  it('resumes immutable evidence and persists incomplete corrections/selection across reload', async () => {
    const { image, row } = await readySource()
    const response = await jsonCommand(`${base}/${image.id}/review/${row.id}`, 'PATCH', { version: 3, selected: false, draft: { ...row.draft, name: '', description: 'Corrected by owner', variations: [] } })
    expect(response.status, await response.clone().text()).toBe(200)
    const review = await response.json()
    expect(review).toMatchObject({ state: 'ready', rows: [{ source: row.source, selected: false, draft: { name: '', description: 'Corrected by owner', categoryId: null, variations: [] } }], source: { version: 4, expiresAt: image.expiresAt } })
    expect(await (await api(`${base}/${image.id}/review`)).json()).toEqual(review)
    await discard(image.id, 4)
    expect((await api(`${base}/${image.id}/review`)).status).toBe(404)
  })
  it('refuses another cafe/creator, customers, signed-out callers and foreign origins', async () => {
    const { image, row } = await readySource()
    const path = `${base}/${image.id}/review`
    expect((await api(path, {}, '')).status).toBe(401)
    expect((await api(path, {}, customerCookie)).status).toBe(403)
    expect((await api(path, {}, otherCookie)).status).toBe(404)
    const foreign = `/api/c/${seed.secondCafe.slug}/admin/assistant/imports/${image.id}`
    expect((await api(`${foreign}/review`)).status).toBe(404)
    for (const action of ['extract', 'cancel']) {
      expect((await jsonCommand(`${foreign}/${action}`, 'POST', { version: 3 })).status).toBe(404)
      expect((await jsonCommand(`${base}/${image.id}/${action}`, 'POST', { version: 3 }, otherCookie)).status).toBe(404)
    }
    expect((await jsonCommand(`${path}/${row.id}`, 'PATCH', { version: 3, selected: false }, otherCookie)).status).toBe(404)
    expect((await api(`${path}/${row.id}`, { method: 'PATCH', headers: { 'origin': 'https://foreign.example', 'content-type': 'application/json' }, body: JSON.stringify({ version: 3, selected: false }) })).status).toBe(403)
    await discard(image.id, 3)
  })
  it('refuses stale versions, nonexistent rows and attempts to rewrite source evidence', async () => {
    const { image, row } = await readySource()
    const path = `${base}/${image.id}/review/${row.id}`
    expect((await jsonCommand(path, 'PATCH', { version: 2, selected: false })).status).toBe(409)
    expect((await jsonCommand(`${base}/${image.id}/review/${crypto.randomUUID()}`, 'PATCH', { version: 3, selected: false })).status).toBe(404)
    expect((await jsonCommand(path, 'PATCH', { version: 3, source: row.source })).status).toBe(400)
    expect((await jsonCommand(`${base}/${image.id}/extract`, 'POST', { version: 3 })).status).toBe(409)
    expect((await discard(image.id, 1)).status).toBe(409)
    await discard(image.id, 3)
  })
  it('reports pending PDF processing and hides configuration details without reserving usage', async () => {
    const image = await source()
    const document = await (await upload('application/pdf', pdf)).json() as AssistantImportSource
    const pdfResponse = await jsonCommand(`${base}/${document.id}/extract`, 'POST', { version: 1 })
    expect(pdfResponse.status).toBe(422)
    expect(await pdfResponse.json()).toMatchObject({ data: { code: 'AI_IMPORT_PDF_PENDING' } })
    const notConfigured = await jsonCommand(`${base}/${image.id}/extract`, 'POST', { version: 1 })
    expect(notConfigured.status).toBe(500)
    // The API standard masks every 5xx, including safe internal configuration errors.
    expect(await notConfigured.json()).toMatchObject({ data: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' } })
    expect(await (await api(`${base}/${image.id}/review`)).json()).toMatchObject({ state: 'none', source: { version: 1 } })
    const db = e2eDatabase(seed.dbFile)
    try {
      const usage = await db.execute({ sql: 'select count(*) as n from assistant_usage where feature = \'menu_import\' and user_id = (select user_id from assistant_imports where id = ?) and tenant_id = (select tenant_id from assistant_imports where id = ?)', args: [image.id, image.id] })
      const leases = await db.execute({ sql: 'select count(*) as n from assistant_import_leases where user_id = (select user_id from assistant_imports where id = ?) and tenant_id = (select tenant_id from assistant_imports where id = ?)', args: [image.id, image.id] })
      expect(Number(usage.rows[0]!.n)).toBe(0)
      expect(Number(leases.rows[0]!.n)).toBe(0)
    }
    finally { db.close() }
    await discard(image.id)
    await discard(document.id)
  })
  it('cancels a processing attempt while keeping its recovery lease and refusing another call', async () => {
    const image = await source()
    const second = await source()
    const db = e2eDatabase(seed.dbFile)
    try {
      const info = await db.execute({ sql: 'select tenant_id, user_id from assistant_imports where id = ?', args: [image.id] })
      const owner = info.rows[0]!
      const deadline = Date.now() + 90_000
      await db.execute({ sql: 'update assistant_imports set review_state = \'processing\', extraction_id = \'test-attempt\', extraction_deadline = ?, version = 2 where id = ?', args: [deadline, image.id] })
      await db.execute({ sql: 'insert into assistant_import_leases (tenant_id, user_id, extraction_id, deadline) values (?, ?, ?, ?)', args: [owner.tenant_id!, owner.user_id!, 'test-attempt', deadline] })
      expect((await jsonCommand(`${base}/${image.id}/cancel`, 'POST', { version: 1 })).status).toBe(409)
      const cancelled = await jsonCommand(`${base}/${image.id}/cancel`, 'POST', { version: 2 })
      expect(cancelled.status).toBe(200)
      expect(await cancelled.json()).toMatchObject({ state: 'failed', error: 'AI_IMPORT_CANCELLED', retryAt: new Date(deadline).toISOString(), source: { version: 3 } })
      await discard(image.id, 3)
      expect((await jsonCommand(`${base}/${second.id}/extract`, 'POST', { version: 1 })).status).toBe(409)
      await db.execute({ sql: 'delete from assistant_import_leases where tenant_id = ? and user_id = ?', args: [owner.tenant_id!, owner.user_id!] })
      await discard(second.id)
    }
    finally { db.close() }
  })
  it('hides expired reviews before cleanup and bounds actual chunked review-command bytes', async () => {
    const { image, row } = await readySource()
    const body = new ReadableStream<Uint8Array>({ start(c) {
      c.enqueue(new Uint8Array(64 * 1024 + 1))
      c.close()
    } })
    const init: RequestInit & { duplex: 'half' } = { method: 'PATCH', headers: { 'content-type': 'application/json' }, body, duplex: 'half' }
    expect((await api(`${base}/${image.id}/review/${row.id}`, init)).status).toBe(413)
    const db = e2eDatabase(seed.dbFile)
    try {
      await db.execute({ sql: 'update assistant_imports set expires_at = 0 where id = ?', args: [image.id] })
    }
    finally { db.close() }
    expect((await api(`${base}/${image.id}/review`)).status).toBe(404)
    expect((await jsonCommand(`${base}/${image.id}/review/${row.id}`, 'PATCH', { version: 3, selected: false })).status).toBe(404)
    expect((await fetch(`${host}/api/health`)).status).toBe(200)
  })
})

const draftPath = (sourceId: string, rowId: string) => `${base}/${sourceId}/review/${rowId}/create-draft`
const createDraft = (sourceId: string, rowId: string, version: number, key = crypto.randomUUID(), confirmDuplicate = false, session = cookie) => api(draftPath(sourceId, rowId), {
  method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify({ version, confirmDuplicate }),
}, session)

async function correctedSource(name = `Imported coffee ${crypto.randomUUID().slice(0, 8)}`) {
  const { image, row } = await readySource()
  const db = e2eDatabase(seed.dbFile)
  let categoryId: string
  try {
    const categories = await db.execute({ sql: 'select c.id from menu_categories c where c.status = \'active\' and c.tenant_id = (select tenant_id from assistant_imports where id = ?) and not exists (select 1 from menu_categories child where child.parent_id = c.id) limit 1', args: [image.id] })
    categoryId = String(categories.rows[0]!.id)
  }
  finally { db.close() }
  const draft: AssistantImportDraft = { ...row.draft, name, categoryId }
  const edited = await jsonCommand(`${base}/${image.id}/review/${row.id}`, 'PATCH', { version: 3, draft })
  expect(edited.status).toBe(200)
  return { image, row: { ...row, draft }, version: 4 }
}

describe('explicit reviewed draft creation against the built app, without inference', () => {
  it('creates a draft from saved corrections, replays safely and resumes its receipt', async () => {
    const { image, row } = await correctedSource()
    const key = crypto.randomUUID()
    const response = await createDraft(image.id, row.id, 4, key)
    expect(response.status, await response.clone().text()).toBe(200)
    const result = await response.json()
    expect(result).toMatchObject({ version: 5, alreadyCreated: false, replayed: false })
    const item = await api(`/api/c/nuk/admin/menu/items/${result.itemId}`)
    expect(await item.json()).toMatchObject({ name: row.draft.name, categoryId: row.draft.categoryId, image: null, status: 'draft' })
    expect(await (await createDraft(image.id, row.id, 4, key)).json()).toEqual({ ...result, replayed: true })
    expect(await (await createDraft(image.id, row.id, 5, crypto.randomUUID(), true)).json()).toMatchObject({ itemId: result.itemId, alreadyCreated: true })
    const resumed = await (await api(`${base}/${image.id}/review`)).json()
    expect(resumed).toMatchObject({ source: { version: 5, expiresAt: image.expiresAt }, rows: [{ source: row.source, createdItemId: result.itemId }] })
    expect((await jsonCommand(`${base}/${image.id}/review/${row.id}`, 'PATCH', { version: 5, selected: false })).status).toBe(409)
    await discard(image.id, 5)
    expect((await api(`/api/c/nuk/admin/menu/items/${result.itemId}`)).status).toBe(200)
    expect((await createDraft(image.id, row.id, 4, key)).status).toBe(404)
  })

  it('requires both normal owner access and creator/cafe isolation before creating or replaying', async () => {
    const { image, row } = await correctedSource()
    expect((await createDraft(image.id, row.id, 4, crypto.randomUUID(), false, '')).status).toBe(401)
    expect((await createDraft(image.id, row.id, 4, crypto.randomUUID(), false, customerCookie)).status).toBe(403)
    expect((await createDraft(image.id, row.id, 4, crypto.randomUUID(), false, otherCookie)).status).toBe(404)
    const foreign = draftPath(image.id, row.id).replace('/c/nuk/', `/c/${seed.secondCafe.slug}/`)
    expect((await jsonCommand(foreign, 'POST', { version: 4 })).status).toBe(400)
    expect((await api(foreign, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ version: 4 }) })).status).toBe(404)
    await discard(image.id, 4)
  })

  it('validates the action key, bounded strict body and normal origin policy', async () => {
    const { image, row } = await correctedSource()
    const path = draftPath(image.id, row.id)
    expect((await jsonCommand(path, 'POST', { version: 4 })).status).toBe(400)
    expect((await createDraft(image.id, row.id, 4, 'invalid-key')).status).toBe(400)
    for (const extra of [{ name: 'Fresh request data' }, { publish: true }, { tenantId: 'foreign' }, { createdItemId: crypto.randomUUID() }]) {
      expect((await api(path, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ version: 4, ...extra }) })).status).toBe(400)
    }
    expect((await api(path, { method: 'POST', headers: { 'origin': 'https://foreign.example', 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ version: 4 }) })).status).toBe(403)
    const stream = new ReadableStream<Uint8Array>({ start(c) {
      c.enqueue(new Uint8Array(64 * 1024 + 1))
      c.close()
    } })
    const init: RequestInit & { duplex: 'half' } = { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: stream, duplex: 'half' }
    expect((await api(path, init)).status).toBe(413)
    expect((await fetch(`${host}/api/health`)).status).toBe(200)
    await discard(image.id, 4)
  })

  it('rejects stale/unselected/incomplete rows and leaves corrections available for retry', async () => {
    const { image, row } = await correctedSource()
    expect((await createDraft(image.id, row.id, 3)).status).toBe(409)
    expect((await createDraft(image.id, crypto.randomUUID(), 4)).status).toBe(404)
    await jsonCommand(`${base}/${image.id}/review/${row.id}`, 'PATCH', { version: 4, selected: false })
    expect((await createDraft(image.id, row.id, 5)).status).toBe(409)
    await jsonCommand(`${base}/${image.id}/review/${row.id}`, 'PATCH', { version: 5, selected: true, draft: { ...row.draft, categoryId: null } })
    const key = crypto.randomUUID()
    expect((await createDraft(image.id, row.id, 6, key)).status).toBe(400)
    expect(await (await api(`${base}/${image.id}/review`)).json()).toMatchObject({ source: { version: 6 }, rows: [{ draft: { categoryId: null } }] })
    await jsonCommand(`${base}/${image.id}/review/${row.id}`, 'PATCH', { version: 6, draft: row.draft })
    expect((await createDraft(image.id, row.id, 7, key)).status).toBe(200)
    await discard(image.id, 8)
  })

  it('warns about an existing matching name and requires explicit confirmation', async () => {
    const first = await correctedSource()
    const created = await (await createDraft(first.image.id, first.row.id, 4)).json()
    await discard(first.image.id, 5)
    const second = await correctedSource(first.row.draft.name.toUpperCase())
    const key = crypto.randomUUID()
    const duplicate = await createDraft(second.image.id, second.row.id, 4, key)
    expect(duplicate.status).toBe(409)
    expect(await duplicate.json()).toMatchObject({ data: { code: 'ITEM_NAME_EXISTS' } })
    const confirmed = await (await createDraft(second.image.id, second.row.id, 4, key, true)).json()
    expect(confirmed.itemId).not.toBe(created.itemId)
    expect((await createDraft(second.image.id, second.row.id, 4, key)).status).toBe(422)
    await discard(second.image.id, 5)
  })

  it('keeps partial successes and saves only corrected failed rows on retry', async () => {
    const { image, row } = await correctedSource()
    const invalid = reviewRow()
    invalid.draft.name = `Imported second ${crypto.randomUUID().slice(0, 8)}`
    const db = e2eDatabase(seed.dbFile)
    try {
      await db.execute({ sql: 'update assistant_imports set review_rows = ? where id = ?', args: [JSON.stringify([row, invalid]), image.id] })
    }
    finally { db.close() }
    const first = await (await createDraft(image.id, row.id, 4)).json()
    const key = crypto.randomUUID()
    expect((await createDraft(image.id, invalid.id, 5, key)).status).toBe(400)
    const resumed = await (await api(`${base}/${image.id}/review`)).json()
    expect(resumed.rows[0].createdItemId).toBe(first.itemId)
    expect(resumed.rows[1].createdItemId).toBeUndefined()
    await jsonCommand(`${base}/${image.id}/review/${invalid.id}`, 'PATCH', { version: 5, draft: { ...invalid.draft, categoryId: row.draft.categoryId } })
    const second = await (await createDraft(image.id, invalid.id, 6, key)).json()
    expect(second.itemId).not.toBe(first.itemId)
    await discard(image.id, 7)
  })

  it('refuses incomplete processing and expired replay access without reserving AI usage', async () => {
    const untouched = await source()
    expect((await createDraft(untouched.id, crypto.randomUUID(), 1)).status).toBe(409)
    await discard(untouched.id)
    const { image, row } = await correctedSource()
    const key = crypto.randomUUID()
    const created = await (await createDraft(image.id, row.id, 4, key)).json()
    const db = e2eDatabase(seed.dbFile)
    try {
      await db.execute({ sql: 'update assistant_imports set expires_at = 0 where id = ?', args: [image.id] })
      expect(Number((await db.execute('select count(*) as n from assistant_usage where feature = \'menu_import\'')).rows[0]!.n)).toBe(0)
    }
    finally { db.close() }
    expect((await createDraft(image.id, row.id, 4, key)).status).toBe(404)
    expect((await api(`/api/c/nuk/admin/menu/items/${created.itemId}`)).status).toBe(200)
  })
})
