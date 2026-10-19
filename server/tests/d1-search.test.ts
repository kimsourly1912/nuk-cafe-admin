import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import type { Actor } from '#server/features/identity'
import { createStaff, listStaff, seedFirstOwner } from '#server/features/identity/staff.service'
import { getPlatformAccount, listPlatformAccounts } from '#server/features/identity/accounts.service'
import { createCategory } from '#server/features/menu/categories.service'
import { createItem, listItems } from '#server/features/menu/items.service'
import { addOwner, createTenant, getPlatformOverview, getTenant, listPlatformActivity, listTenants, removeOwner, seedTenant, updateTenantNotes } from '#server/features/tenants'
import type { Db } from '#server/utils/batch'
import { migrationFiles } from '#server/tests/support/db'
import type { StaffListQuery } from '#shared/contracts/staff'
import { branches, user } from '#server/db/tables'
import { interleaved } from '#server/tests/support/interleave'
import { expectApiError } from '#server/tests/support/failure'
import { newId } from '#server/utils/ids'

// Real D1 (workerd, through wrangler's platform proxy) with the app's Drizzle D1 adapter. The
// other server tests run on libsql, which accepts a LIKE pattern of 50,000 bytes where D1 refuses
// one over 50 ("LIKE or GLOB pattern too complex"), so only this file shows a search works there.

const migrations = fileURLToPath(new URL('../db/migrations/sqlite', import.meta.url))
const SLASH = String.fromCharCode(92)
const KHMER_17 = 'ក'.repeat(17)
const ASCII_49 = 'a'.repeat(30) + 'Name' + 'b'.repeat(15)
const SYMBOLS = `Half% _off_ ${SLASH} cafe`

let proxy: Awaited<ReturnType<typeof getPlatformProxy>>
let db: Db
let ours: string
let theirs: string

beforeAll(async () => {
  proxy = await getPlatformProxy({ configPath: fileURLToPath(new URL('./support/d1-wrangler.json', import.meta.url)), persist: false })
  const d1 = (proxy.env as { DB: { prepare: (statement: string) => { run: () => Promise<unknown> } } }).DB
  for (const file of migrationFiles()) {
    for (const statement of readFileSync(`${migrations}/${file}`, 'utf8').split('--> statement-breakpoint')) {
      if (statement.trim()) await d1.prepare(statement).run()
    }
  }
  db = drizzle(d1 as never, { casing: 'snake_case' }) as unknown as Db
  ours = (await seedTenant(db, { name: 'Our cafe', slug: 'ours' })).id
  const admin = { userId: 'superadmin-1', requestId: 'req-1' }
  const other = await createTenant(db, admin, { name: 'Other cafe', slug: 'other', branchName: 'Main', timezone: 'Asia/Phnom_Penh', owner: { kind: 'new', name: 'Their owner', email: 'their@example.com' } })
  theirs = other.tenant.id

  for (const name of [KHMER_17, ASCII_49, SYMBOLS, 'm'.repeat(80)]) {
    await createTenant(db, admin, { name, slug: `c-${Math.abs([...name].reduce((h, c) => (h * 31 + c.codePointAt(0)!) | 0, 7))}`, branchName: 'Main', timezone: 'Asia/Phnom_Penh', owner: { kind: 'new', name: 'Owner', email: `o${Math.abs([...name].reduce((h, c) => (h * 31 + c.codePointAt(0)!) | 0, 3))}@example.com` } })
  }

  const owner = await seedFirstOwner(db, ours, { name: 'Our owner', email: 'owner@example.com' })
  const actor: Actor = { userId: owner!.staff.id, tenantId: ours, role: 'owner' }
  for (const [i, name] of [KHMER_17, ASCII_49, SYMBOLS].entries()) await createStaff(db, actor, { name, email: `staff${i}@example.com`, admin: false, memberships: [] })

  for (const tenantId of [ours, theirs]) {
    const itemActor: Actor = { ...actor, tenantId }
    const top = await createCategory(db, itemActor, { name: 'Drinks', description: '', parentId: null, availabilityRuleIds: [] })
    const sub = await createCategory(db, itemActor, { name: 'Hot', description: '', parentId: top.id, availabilityRuleIds: [] })
    for (const name of [KHMER_17, ASCII_49, SYMBOLS, 'm'.repeat(80)]) {
      await createItem(db, itemActor, { categoryId: sub.id, name, description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 100, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] })
    }
  }
}, 120_000)

afterAll(async () => {
  await proxy?.dispose()
})

const searches = [KHMER_17, ASCII_49, ASCII_49.toUpperCase(), 'm'.repeat(80), 'm'.repeat(100), 'ក'.repeat(100), '%', '_', SLASH, '% _off_ ', '%'.repeat(25), SLASH.repeat(60), `${KHMER_17} `]

describe('searching on real D1', { timeout: 60_000, tags: ['slow'] }, () => {
  it('rejects a LIKE pattern over 50 bytes here (the control: what the old search sent)', async () => {
    const like = (pattern: string) => db.run(sql`select 1 where 'x' like ${pattern} escape ${sql.raw(`'${SLASH}'`)}`)
    const tooComplex = { cause: expect.objectContaining({ message: expect.stringMatching(/too complex/) }) }
    await expect(like(`%${ASCII_49}%`)).rejects.toMatchObject(tooComplex)
    await expect(like(`%${KHMER_17}%`)).rejects.toMatchObject(tooComplex)
    await expect(like(`%${'%'.repeat(25).replace(/%/g, `${SLASH}%`)}%`)).rejects.toMatchObject(tooComplex)
    await expect(like(`%${'a'.repeat(48)}%`)).resolves.toBeDefined()
  })

  it('lists items for every boundary search, matching what libsql returns, and only the cafe\'s own', async () => {
    const expected = new Map<string, string[]>([
      [KHMER_17, [KHMER_17]],
      [ASCII_49, [ASCII_49]],
      [ASCII_49.toUpperCase(), [ASCII_49]],
      ['m'.repeat(80), ['m'.repeat(80)]],
      ['%', [SYMBOLS]],
      ['_', [SYMBOLS]],
      [SLASH, [SYMBOLS]],
      ['% _off_ ', [SYMBOLS]],
    ])
    for (const search of searches) {
      const page = await listItems(db, ours, { page: 1, pageSize: 20, status: 'all', search })
      expect(page.items.map(i => i.name), search).toEqual(expected.get(search) ?? [])
      expect(page.total, search).toBe(page.items.length)
    }
  })

  it('lists people for every boundary search', async () => {
    const expected = new Map<string, string[]>([[KHMER_17, [KHMER_17]], [ASCII_49, [ASCII_49]], [ASCII_49.toUpperCase(), [ASCII_49]], ['%', [SYMBOLS]], ['_', [SYMBOLS]], [SLASH, [SYMBOLS]], ['% _off_ ', [SYMBOLS]]])
    const actor: Actor = { userId: 'x', tenantId: ours, role: 'owner' }
    for (const search of searches) {
      const page = await listStaff(db, actor, { page: 1, pageSize: 20, search })
      expect(page.items.map(s => s.name), search).toEqual(expected.get(search) ?? [])
      expect(page.total, search).toBe(page.items.length)
    }
    // The other cafe has none of these people.
    expect((await listStaff(db, { ...actor, tenantId: theirs }, { page: 1, pageSize: 20, search: ASCII_49 })).total).toBe(0)
  })

  it('lists the platform\'s accounts for every boundary search and by kind (P1, D187)', async () => {
    const expected = new Map<string, string[]>([[KHMER_17, [KHMER_17]], [ASCII_49, [ASCII_49]], [ASCII_49.toUpperCase(), [ASCII_49]], ['%', [SYMBOLS]], ['_', [SYMBOLS]], [SLASH, [SYMBOLS]], ['% _off_ ', [SYMBOLS]]])
    for (const search of searches) {
      const page = await listPlatformAccounts(db, { page: 1, pageSize: 20, search })
      expect(page.items.map(a => a.name), search).toEqual(expected.get(search) ?? [])
      expect(page.total, search).toBe(page.items.length)
    }
    const owners = await listPlatformAccounts(db, { page: 1, pageSize: 100, kind: 'owner' })
    expect(owners.items.map(a => a.name)).toEqual(expect.arrayContaining(['Our owner', 'Their owner']))
    expect((await listPlatformAccounts(db, { page: 1, pageSize: 100, kind: 'staff' })).items.map(a => a.name).sort()).toEqual([KHMER_17, ASCII_49, SYMBOLS].sort())
    expect((await listPlatformAccounts(db, { page: 1, pageSize: 100, kind: 'superadmin' })).total).toBe(0)
    const ours = owners.items.find(a => a.name === 'Our owner')!
    expect((await getPlatformAccount(db, ours.id)).cafes).toEqual([expect.objectContaining({ name: 'Our cafe', role: 'owner', onlyActiveOwner: true })])
  })

  it('lists people by role and branch from the cafe memberships, once each, without scanning users', async () => {
    const d1 = (proxy.env as { DB: { prepare: (statement: string) => { bind: (...values: unknown[]) => { all: () => Promise<{ results: Record<string, unknown>[] }> } } } }).DB
    const seen: { sql: string, params: unknown[] }[] = []
    const logged = drizzle(d1 as never, { casing: 'snake_case', logger: { logQuery: (statement, params) => void seen.push({ sql: statement, params }) } }) as unknown as Db
    const [riverside, airport] = [newId(), newId()]
    await db.insert(branches).values([{ id: riverside, tenantId: ours, name: 'Riverside', timezone: 'Asia/Phnom_Penh', status: 'active', createdAt: new Date() }, { id: airport, tenantId: ours, name: 'Airport', timezone: 'Asia/Phnom_Penh', status: 'archived', createdAt: new Date() }])
    const ownerId = (await listStaff(db, { userId: 'x', tenantId: ours, role: 'owner' }, { page: 1, pageSize: 20, search: 'owner@example.com' })).items[0]!.id
    const actor: Actor = { userId: ownerId, tenantId: ours, role: 'owner' }
    await createStaff(db, actor, { name: 'Dara Lead', email: 'dara@example.com', admin: false, memberships: [{ branchId: riverside, role: 'manager' }] })
    // Archived since: the person keeps their row at the second branch.
    const dara = (await listStaff(db, actor, { page: 1, pageSize: 20, search: 'dara@' })).items[0]!
    await db.run(sql`insert into branch_staff (tenant_id, branch_id, user_id, role) values (${ours}, ${airport}, ${dara.id}, 'staff')`)
    const queries: [Partial<StaffListQuery>, string[]][] = [
      [{ role: 'admin' }, ['Our owner']],
      [{ role: 'manager' }, ['Dara Lead']],
      [{ role: 'staff' }, ['Dara Lead']],
      [{ branchId: riverside }, ['Dara Lead']],
      [{ branchId: airport }, ['Dara Lead']],
      [{ branchId: riverside, role: 'staff' }, []],
      [{ branchId: airport, role: 'staff', search: 'LEAD' }, ['Dara Lead']],
      [{ role: 'admin', branchId: riverside }, []],
    ]
    for (const [query, names] of queries) {
      seen.length = 0
      const page = await listStaff(logged, actor, { page: 1, pageSize: 20, ...query })
      expect(page.items.map(s => s.name), JSON.stringify(query)).toEqual(names)
      expect(page.total, JSON.stringify(query)).toBe(names.length)
      const reads = seen.filter(s => /from "user"/.test(s.sql))
      expect(reads).toHaveLength(2)
      for (const read of reads) {
        const plan = (await d1.prepare(`explain query plan ${read.sql}`).bind(...read.params).all()).results.map(r => String(r.detail))
        expect(plan.filter(d => /^SCAN user\b/.test(d)), `${JSON.stringify(query)}: ${plan.join(' | ')}`).toEqual([])
      }
    }
    // The other cafe sees none of them.
    const theirActor: Actor = { ...actor, tenantId: theirs }
    for (const query of [{ role: 'manager' }, { role: 'staff' }, { branchId: riverside }, { branchId: airport }, { search: 'dara' }] as Partial<StaffListQuery>[]) {
      expect((await listStaff(db, theirActor, { page: 1, pageSize: 20, ...query })).total, JSON.stringify(query)).toBe(0)
    }
  })

  it('lists cafes for every boundary search, by name or address', async () => {
    const expected = new Map<string, number>([[KHMER_17, 1], [ASCII_49, 1], [ASCII_49.toUpperCase(), 1], ['m'.repeat(80), 1], ['%', 1], ['_', 1], [SLASH, 1], ['% _off_ ', 1]])
    for (const search of searches) {
      const page = await listTenants(db, { page: 1, pageSize: 20, search })
      expect(page.total, search).toBe(expected.get(search) ?? 0)
      expect(page.items, search).toHaveLength(expected.get(search) ?? 0)
    }
  })

  it('changes owners and notes in one batch with their guards, and finds cafes without an active owner (P2, D189)', async () => {
    const admin = { userId: 'superadmin-1' }
    const cafe = await getTenant(db, theirs)
    const first = cafe.owners[0]!
    const added = await addOwner(db, admin, theirs, { version: cafe.version, reason: 'Asked', owner: { kind: 'new', name: 'Second owner', email: 'second@example.com' } })
    const second = added.tenant.owners.find(owner => owner.email === 'second@example.com')!
    // The second owner banned while the first is removed: the last-owner guard stops the batch on D1.
    const racing = interleaved(db, () => db.update(user).set({ banned: true }).where(eq(user.id, second.id)))
    await expectApiError(() => removeOwner(racing, admin, theirs, first.id, { version: added.tenant.version, reason: 'Left' }), 409, 'LAST_OWNER')
    expect((await getTenant(db, theirs)).owners.map(owner => owner.id).sort()).toEqual([first.id, second.id].sort())
    expect((await listTenants(db, { page: 1, pageSize: 20, owner: 'none' })).items.map(t => t.id)).toEqual([])
    await db.update(user).set({ banned: true }).where(eq(user.id, first.id))
    expect((await listTenants(db, { page: 1, pageSize: 20, owner: 'none' })).items.map(t => t.id)).toEqual([theirs])

    const notes = await updateTenantNotes(db, admin, theirs, { version: 0, contactName: 'Bea', contactPhone: '+85512345678', notes: null })
    expect(notes.notes).toMatchObject({ contactName: 'Bea', version: 1 })
    await expectApiError(() => updateTenantNotes(db, admin, theirs, { version: 0, contactName: 'Late', contactPhone: null, notes: null }), 409, 'VERSION_CONFLICT')
    expect((await getTenant(db, ours)).notes.version).toBe(0)
  })

  it('reads the Overview and the platform\'s Activity, only its own rows, filtered by cafe and date (P3, D191)', async () => {
    const overview = await getPlatformOverview(db, 'Asia/Phnom_Penh')
    expect(overview.cafes.active).toBeGreaterThan(1)
    expect(overview.noActiveOwner).toBe(1)
    const activity = await listPlatformActivity(db, { page: 1, pageSize: 100 }, 'Asia/Phnom_Penh')
    expect(activity.items.every(entry => entry.action.startsWith('tenant.') || entry.action.startsWith('platform.'))).toBe(true)
    expect(activity.items.map(entry => entry.action)).toContain('tenant.owner.add')
    expect(activity.items.map(entry => entry.action)).not.toContain('staff.create')
    const theirsOnly = await listPlatformActivity(db, { page: 1, pageSize: 100, tenantId: theirs, from: '2000-01-01', to: '2999-12-31' }, 'Asia/Phnom_Penh')
    expect(theirsOnly.items.length).toBeGreaterThan(0)
    expect(theirsOnly.items.every(entry => entry.cafe?.id === theirs)).toBe(true)
  })
})
