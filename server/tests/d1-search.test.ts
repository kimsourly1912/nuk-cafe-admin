import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { asc, count, eq, inArray, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import type { Actor } from '#server/features/identity'
import { createStaff, listStaff, seedFirstOwner } from '#server/features/identity/staff.service'
import { getPlatformAccount, listPlatformAccounts } from '#server/features/identity/accounts.service'
import { createCategory } from '#server/features/menu/categories.service'
import { createItem, listItems } from '#server/features/menu/items.service'
import { addOwner, createTenant, getPlatformHealth, getPlatformOverview, getTenant, listPlatformActivity, listTenants, removeOwner, seedTenant, updateTenantNotes } from '#server/features/tenants'
import type { Db } from '#server/utils/batch'
import { deleteOldest, insertAll, requireCount, requireOneChange, runBatch, updateAtVersion } from '#server/utils/batch'
import { byId, byName, firstRow, hasAny, inTenant, nextPosition, readPage } from '#server/utils/query'
import { menuOptionSets, menuOptionValues } from '#server/features/menu/menu.schema'
import { migrationFiles, addBranchStaff, createUser, insertBranch } from '#server/tests/support/db'
import type { StaffListQuery } from '#shared/contracts/staff'
import { branches, user } from '#server/db/tables'
import { recordJobRun } from '#server/features/platform'
import { allowSupport, endSupport, openSupportVisit, supportActor } from '#server/features/support'
import { interleaved } from '#server/tests/support/interleave'
import { expectApiError } from '#server/tests/support/failure'
import { newId } from '#server/utils/ids'
import { workspaceRoles } from '#server/features/identity/identity.repository'

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
      // The page and its total are one batch: the category's name keeps its own column (D170, D194).
      expect(page.items.every(i => i.categoryName === 'Hot' && i.priceMinMinor === 100), search).toBe(true)
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
    // The D1 driver also omits batch statements from the logger (D194).
    const batch = logged.batch.bind(logged)
    logged.batch = ((items) => {
      for (const item of items) {
        seen.push((item as unknown as { toSQL: () => { sql: string, params: unknown[] } }).toSQL())
      }
      return batch(items)
    }) as typeof logged.batch
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

  it('reads System health and records job runs, the 5-minute success throttle included (P4, D192)', async () => {
    const at = new Date()
    await recordJobRun(db, 'platform:deliver-outbox', 'success', at)
    await recordJobRun(db, 'platform:deliver-outbox', 'success', new Date(at.getTime() + 60_000))
    await recordJobRun(db, 'orders:expire-unpaid', 'failure', at)
    const health = await getPlatformHealth(db)
    const jobs = new Map(health.jobs.map(job => [job.job, job]))
    expect(jobs.get('platform:deliver-outbox')).toMatchObject({ state: 'ok', lastSuccessAt: at.toISOString() })
    expect(jobs.get('orders:expire-unpaid')).toMatchObject({ state: 'failing', failuresInARow: 1 })
    expect(health.outbox.groups.every(group => typeof group.kind === 'string')).toBe(true)
  })

  it('allows support once, opens a visit that only reads, and ends it, with the guards in D1\'s batch (P5, D193)', async () => {
    const owner = { userId: 'owner-d1', tenantId: ours, role: 'owner' as const }
    const { active } = await allowSupport(db, owner)
    await expectApiError(() => allowSupport(db, owner), 409, 'SUPPORT_ALREADY_ALLOWED')
    await openSupportVisit(db, { userId: 'super-d1', sessionId: 'session-d1' }, ours, async () => true)
    const request = { user: { id: 'super-d1', email: 'ops@example.com', name: 'Ops', role: 'superadmin', twoFactorEnabled: true } as never, sessionId: 'session-d1', tenantId: ours, method: 'GET', path: '/api/c/ours/admin/menu/items' }
    expect(await supportActor(db, request, { menu: ['read'] })).toMatchObject({ role: 'support' })
    await expectApiError(() => supportActor(db, { ...request, method: 'POST' }, { menu: ['write'] }), 403, 'SUPPORT_READ_ONLY')
    expect(await supportActor(db, { ...request, tenantId: theirs }, { menu: ['read'] })).toBeUndefined()
    await endSupport(db, owner, active!.id)
    expect(await supportActor(db, request, { menu: ['read'] })).toBeUndefined()
  })

  it('runs the repository building blocks: a page and its total in one batch, versioned writes and $count guards (D194)', async () => {
    const at = new Date()
    const stale = () => new Error('stale')
    const sets = ['Zeta', 'alpha', 'Beta'].map((name, i) => ({ id: newId(), tenantId: ours, name, createdAt: at, updatedAt: at, sortOrder: i }))
    await runBatch(db, insertAll(db, menuOptionSets, [...sets.map(({ sortOrder: _, ...set }) => set), { id: newId(), tenantId: theirs, name: 'Theirs', createdAt: at, updatedAt: at }]), stale)
    const mine = inTenant(menuOptionSets, ours, inArray(menuOptionSets.id, sets.map(set => set.id)))
    const columns = { id: menuOptionSets.id, name: menuOptionSets.name, version: menuOptionSets.version }

    const read = (page: number) => readPage(db, db.select(columns).from(menuOptionSets).where(mine).orderBy(byName(menuOptionSets.name), asc(menuOptionSets.id)).$dynamic(),
      db.select({ total: count() }).from(menuOptionSets).where(mine), { page, pageSize: 2 })
    expect(await read(1)).toMatchObject({ total: 3, rows: [{ name: 'alpha', version: 1 }, { name: 'Beta', version: 1 }] })
    expect(await read(2)).toMatchObject({ total: 3, rows: [{ name: 'Zeta' }] })
    expect(await firstRow(db.select(columns).from(menuOptionSets).where(byId(menuOptionSets, ours, sets[0]!.id)))).toMatchObject({ name: 'Zeta' })
    expect(await hasAny(db, menuOptionSets, inTenant(menuOptionSets, theirs, eq(menuOptionSets.name, 'Theirs')))).toBe(true)
    expect(await db.$count(menuOptionSets, mine)).toBe(3)

    // 60 values of 9 columns: several statements under D1's 100 parameters, in one batch.
    const values = Array.from({ length: 60 }, (_, i) => ({ id: newId(), tenantId: ours, setId: sets[1]!.id, name: `Value ${i}`, sortOrder: i + 1, createdAt: at, updatedAt: at }))
    await runBatch(db, insertAll(db, menuOptionValues, values), stale)
    expect(await nextPosition(db, menuOptionValues, menuOptionValues.sortOrder, inTenant(menuOptionValues, ours, eq(menuOptionValues.setId, sets[1]!.id)))).toBe(61)
    expect(await deleteOldest(db, menuOptionValues, menuOptionValues.id, inTenant(menuOptionValues, ours, eq(menuOptionValues.setId, sets[1]!.id)), [asc(menuOptionValues.sortOrder)], 50)).toBe(50)

    const key = { tenantId: ours, id: sets[2]!.id, version: 1 }
    await runBatch(db, [updateAtVersion(db, menuOptionSets, key, { name: 'Beta 2' }), requireOneChange(db), requireCount(db, db.$count(menuOptionSets, mine), 3)], stale)
    await expect(runBatch(db, [updateAtVersion(db, menuOptionSets, key, { name: 'Stale' }), requireOneChange(db)], stale)).rejects.toThrow('stale')
    await expect(runBatch(db, [updateAtVersion(db, menuOptionSets, { ...key, version: 2 }, { name: 'Counted' }), requireCount(db, db.$count(menuOptionSets, mine), 4)], stale)).rejects.toThrow('stale')
    expect(await firstRow(db.select(columns).from(menuOptionSets).where(byId(menuOptionSets, ours, sets[2]!.id)))).toMatchObject({ name: 'Beta 2', version: 2 })
  })
  it('reads an account\'s roles across two cafes in a joined batch, excluding other accounts and archived branches (D194)', async () => {
    const person = await createUser(db, 'workspace-person@example.com', 'Person')
    const stranger = await createUser(db, 'workspace-stranger@example.com', 'Stranger')
    for (const [tenantId, role] of [[ours, 'staff'], [theirs, 'manager']] as const) {
      const branchId = newId()
      await insertBranch(db, { id: branchId, tenantId, name: 'Workspace branch', timezone: 'Asia/Phnom_Penh' })
      await addBranchStaff(db, branchId, person.id, role, tenantId)
      await addBranchStaff(db, branchId, stranger.id, 'manager', tenantId)
    }
    const archived = newId()
    await insertBranch(db, { id: archived, tenantId: ours, name: 'Closed', timezone: 'Asia/Phnom_Penh', status: 'archived' })
    await addBranchStaff(db, archived, person.id, 'manager', ours)
    const result = await workspaceRoles(db, person.id)
    expect(result.memberships).toEqual(expect.arrayContaining([{ tenantId: ours, role: 'member' }, { tenantId: theirs, role: 'member' }]))
    expect(result.memberships).toHaveLength(2)
    expect(result.staff).toEqual(expect.arrayContaining([{ tenantId: ours, role: 'staff' }, { tenantId: theirs, role: 'manager' }]))
    expect(result.staff).toHaveLength(2)
  })
})
