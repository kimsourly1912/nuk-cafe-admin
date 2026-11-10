import { url } from '@nuxt/test-utils/e2e'
import { describe, expect, inject, it } from 'vitest'
import type { BranchLayout, CustomLook, SaveLayoutInput } from '#shared/contracts/shop-layout'
import { LAYOUT_MAX_BODY_BYTES } from '#shared/contracts/shop-layout'
import { jsonBytes, largestLayout } from '../../server/tests/support/layouts'
import { setupE2e } from './support/mock-api'
import { clientHeaders } from './support/client-address'

await setupE2e()

// The shop layout's routes (step 2a, D273) on the built server and its seeded database: real
// sessions, the owners-only permission, the version lock and the route's larger body limit. The
// rules themselves are covered by the server tests (branches.layout.service.test.ts).

const seed = inject('shopSeed')
const origin = new URL(url('/')).origin
const bean = seed.secondCafe
const layoutOf = (slug: string, branchId: string) => url(`/api/c/${slug}/admin/branches/${branchId}/layout`)

async function signIn(account: { email: string, password: string }) {
  const response = await fetch(url('/api/auth/sign-in/email'), { method: 'POST', headers: { 'content-type': 'application/json', origin, ...clientHeaders() }, body: JSON.stringify(account) })
  expect(response.status).toBe(200)
  return response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
}

const read = (path: string, cookie: string) => fetch(path, { headers: { cookie } })
const put = (path: string, cookie: string, body: unknown) =>
  fetch(path, { method: 'PUT', headers: { 'content-type': 'application/json', origin, cookie }, body: typeof body === 'string' ? body : JSON.stringify(body) })

const room = (id: string): SaveLayoutInput['layout']['floors'][number] => ({
  id,
  name: 'Ground',
  height: 300,
  hasRoof: true,
  outline: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 500 }, { x: 0, y: 500 }],
  edges: [{ kind: 'wall', openings: [{ id: 'door', kind: 'door', offset: 250, width: 100 }] }, { kind: 'wall', openings: [] }, { kind: 'wall', openings: [] }, { kind: 'wall', openings: [] }],
  walls: [],
  items: [],
})

describe('the shop layout over HTTP', () => {
  it('an owner reads the branch\'s tables, places one, and a stale save is refused', async () => {
    const owner = await signIn(seed.customers.beanOwner)
    const path = layoutOf(bean.slug, bean.branchId)
    const first = await read(path, owner)
    expect(first.status).toBe(200)
    const layout = await first.json() as BranchLayout
    const b1 = layout.tables.find(table => table.label === 'B1')!
    expect(b1.seats).toBe(2)

    const body: SaveLayoutInput = { version: layout.version, layout: { floors: [room('ground')], placements: [{ tableId: b1.id, floorId: 'ground', x: 200, y: 200, rotation: 0, width: 80, depth: 80, lookId: 'round-cafe' }] } }
    const saved = await put(path, owner, body)
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({ version: layout.version + 1, placements: [{ tableId: b1.id, x: 200 }] })

    const stale = await put(path, owner, body)
    expect(stale.status).toBe(409)
    expect((await stale.json()).data.code).toBe('VERSION_CONFLICT')
    // Bad geometry never reaches the service.
    const open = await put(path, owner, { ...body, version: layout.version + 1, layout: { ...body.layout, floors: [{ ...room('ground'), outline: [{ x: 0, y: 0 }, { x: 600, y: 0 }] }] } })
    expect(open.status).toBe(400)
  })

  it('takes a save larger than other routes\' 64 KB, up to its own limit', async () => {
    const owner = await signIn(seed.customers.beanOwner)
    const path = layoutOf(bean.slug, bean.branchId)
    const { version } = await (await read(path, owner)).json() as BranchLayout
    const large = largestLayout([], version)
    expect(jsonBytes(large)).toBeGreaterThan(500 * 1024)
    const saved = await put(path, owner, large)
    expect(saved.status).toBe(200)
    expect((await saved.json() as BranchLayout).floors).toHaveLength(10)
    expect((await put(path, owner, 'x'.repeat(LAYOUT_MAX_BODY_BYTES + 1))).status).toBe(413)
  })

  it('is for owners: a branch manager is refused, and another cafe\'s owner reaches nothing', async () => {
    const manager = await signIn(seed.customers.manager)
    expect((await read(layoutOf('nuk', seed.openBranchId), manager)).status).toBe(403)
    expect((await put(layoutOf('nuk', seed.openBranchId), manager, { version: 0, layout: { floors: [room('ground')], placements: [] } })).status).toBe(403)
    const owner = await signIn(seed.customers.beanOwner)
    expect((await read(layoutOf('nuk', seed.openBranchId), owner)).status).toBe(403)
    // Their own cafe's address with our branch's id: not found.
    expect((await read(layoutOf(bean.slug, seed.openBranchId), owner)).status).toBe(404)
  })

  it('custom looks: an owner adds, edits and deletes one; a look in use stays; it is the cafe\'s own', async () => {
    const owner = await signIn(seed.customers.beanOwner)
    const looks = url(`/api/c/${bean.slug}/admin/furniture-looks`)
    const send = (method: string, path: string, cookie: string, body?: unknown) =>
      fetch(path, { method, headers: { 'content-type': 'application/json', origin, cookie }, ...(body !== undefined && { body: JSON.stringify(body) }) })
    const input = { name: 'HTTP walnut', shape: 'rect', base: 'legs', chair: 'cafe-chair', finishes: { top: 'walnut', base: 'graphite', frame: 'walnut', seat: 'navy' }, defaultWidth: 160, defaultDepth: 80 }

    const created = await send('POST', looks, owner, input)
    expect(created.status).toBe(200)
    const look = await created.json() as CustomLook
    expect(look).toMatchObject({ ...input, version: 1, tables: 0 })
    expect((await send('POST', looks, owner, { ...input, name: 'http WALNUT' })).status).toBe(409)
    // A finish outside the palette, or a size out of range, never reaches the service.
    expect((await send('POST', looks, owner, { ...input, name: 'Bad', finishes: { top: 'gold', base: 'graphite' } })).status).toBe(400)
    expect((await send('POST', looks, owner, { ...input, name: 'Bad', defaultWidth: 601 })).status).toBe(400)

    // Placed on the plan, it can't be deleted; the answer names the table.
    const path = layoutOf(bean.slug, bean.branchId)
    const layout = await (await read(path, owner)).json() as BranchLayout
    const b1 = layout.tables.find(table => table.label === 'B1')!
    const place = (version: number, lookId: string) => put(path, owner, { version, layout: { floors: [room('ground')], placements: [{ tableId: b1.id, floorId: 'ground', x: 200, y: 200, rotation: 0, width: 80, depth: 80, lookId }] } })
    expect((await place(layout.version, look.id)).status).toBe(200)
    expect(await (await read(looks, owner)).json()).toMatchObject([{ id: look.id, tables: 1 }])
    const refused = await send('DELETE', `${looks}/${look.id}?version=1`, owner)
    expect(refused.status).toBe(409)
    expect((await refused.json()).data).toMatchObject({ code: 'LOOK_IN_USE', message: expect.stringContaining('B1') })

    const renamed = await send('PATCH', `${looks}/${look.id}`, owner, { version: 1, ...input, name: 'HTTP oak' })
    expect(await renamed.json()).toMatchObject({ name: 'HTTP oak', version: 2, tables: 1 })
    expect((await send('PATCH', `${looks}/${look.id}`, owner, { version: 1, ...input })).status).toBe(409)

    // Another cafe's owner: refused at our address, not found at theirs, and can't place it.
    const lina = await signIn(seed.customers.layoutOwner)
    expect((await read(looks, lina)).status).toBe(403)
    const theirs = url(`/api/c/${seed.layoutLab.slug}/admin/furniture-looks`)
    expect((await send('PATCH', `${theirs}/${look.id}`, lina, { version: 2, ...input })).status).toBe(404)
    expect((await send('DELETE', `${theirs}/${look.id}?version=2`, lina)).status).toBe(404)
    expect((await read(theirs, lina)).status).toBe(200)
    // A branch manager isn't an owner.
    const manager = await signIn(seed.customers.manager)
    expect((await read(url('/api/c/nuk/admin/furniture-looks'), manager)).status).toBe(403)
    expect((await send('POST', url('/api/c/nuk/admin/furniture-looks'), manager, input)).status).toBe(403)

    // Off the plan again, it deletes.
    expect((await place(layout.version + 1, 'round-cafe')).status).toBe(200)
    expect((await send('DELETE', `${looks}/${look.id}?version=2`, owner)).status).toBe(204)
    expect(await (await read(looks, owner)).json()).toEqual([])
  })
})
