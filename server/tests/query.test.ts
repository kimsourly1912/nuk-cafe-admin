import { and, asc, count, desc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '#server/utils/batch'
import { deleteOldest, insertAll, replaceAll, requireCount, requireOneChange, runBatch, updateAtVersion } from '#server/utils/batch'
import { atVersion, byId, byName, firstRow, hasAny, inJsonArray, inTenant, nextPosition, readPage, searchIn, withPage, withStatus } from '#server/utils/query'
import { createTestDb, ensureTenant } from '#server/tests/support/db'
import { menuOptionSets, menuOptionValues } from '#server/features/menu/menu.schema'

// The repository building blocks (docs/server/repositories.md → Shared helpers, D194) on the
// migrated test database, which refuses more than D1's 100 parameters per statement. Two cafes in
// every case: another cafe's rows are never read or changed.

const now = new Date('2026-10-20T08:00:00.000Z')
const setColumns = { id: menuOptionSets.id, name: menuOptionSets.name, status: menuOptionSets.status, version: menuOptionSets.version }
const stale = () => new Error('stale')
let db: Db

async function addSet(id: string, tenantId: string, name: string, status: 'active' | 'archived' = 'active') {
  await db.insert(menuOptionSets).values({ id, tenantId, name, status, createdAt: now, updatedAt: now })
}
const setsOf = (tenantId: string) => db.select(setColumns).from(menuOptionSets).where(inTenant(menuOptionSets, tenantId)).orderBy(asc(menuOptionSets.id))
const values = (tenantId: string, setId: string, n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => ({ id: `${setId}-v${from + i}`, tenantId, setId, name: `Value ${from + i}`, sortOrder: from + i, createdAt: now, updatedAt: now }))

beforeEach(async () => {
  db = await createTestDb()
  await ensureTenant(db, 'ours')
  await ensureTenant(db, 'theirs')
  await addSet('s1', 'ours', 'size')
  await addSet('s2', 'ours', 'Milk')
  await addSet('s3', 'ours', 'Ice', 'archived')
  await addSet('s4', 'ours', 'Beans')
  await addSet('t1', 'theirs', 'Size')
})

describe('conditions', () => {
  it('binds growing string sets once, keeping exact, empty and duplicate membership semantics', async () => {
    const ids = [...Array.from({ length: 201 }, (_, i) => `missing-${i}`), 's1', 's1', 't1', 'S2']
    const found = await db.select(setColumns).from(menuOptionSets).where(inTenant(menuOptionSets, 'ours', inJsonArray(menuOptionSets.id, ids)))
    expect(found.map(row => row.id)).toEqual(['s1'])
    expect(await db.select(setColumns).from(menuOptionSets).where(inJsonArray(menuOptionSets.id, []))).toEqual([])
  })
  it('inTenant, byId and atVersion name the cafe: another cafe\'s id matches nothing', async () => {
    expect((await setsOf('ours')).map(row => row.id)).toEqual(['s1', 's2', 's3', 's4'])
    expect(await firstRow(db.select(setColumns).from(menuOptionSets).where(byId(menuOptionSets, 'ours', 's2')))).toMatchObject({ name: 'Milk' })
    expect(await firstRow(db.select(setColumns).from(menuOptionSets).where(byId(menuOptionSets, 'ours', 't1')))).toBeUndefined()
    expect(await firstRow(db.select(setColumns).from(menuOptionSets).where(atVersion(menuOptionSets, 'ours', 's2', 1)))).toMatchObject({ id: 's2' })
    expect(await firstRow(db.select(setColumns).from(menuOptionSets).where(atVersion(menuOptionSets, 'ours', 's2', 2)))).toBeUndefined()
  })

  it('inTenant skips undefined conditions; withStatus is none for "all" or no status', async () => {
    const ids = async (status: string | undefined) => (await db.select({ id: menuOptionSets.id }).from(menuOptionSets)
      .where(inTenant(menuOptionSets, 'ours', withStatus(menuOptionSets.status, status), undefined)).orderBy(asc(menuOptionSets.id))).map(row => row.id)
    expect(await ids('active')).toEqual(['s1', 's2', 's4'])
    expect(await ids('archived')).toEqual(['s3'])
    expect(await ids('all')).toEqual(['s1', 's2', 's3', 's4'])
    expect(await ids(undefined)).toEqual(['s1', 's2', 's3', 's4'])
  })

  it('searchIn matches any column as literal text, ignoring ASCII case; no search is no condition', async () => {
    const found = async (search: string | undefined) => (await db.select({ id: menuOptionSets.id }).from(menuOptionSets)
      .where(inTenant(menuOptionSets, 'ours', searchIn(search, menuOptionSets.name, menuOptionSets.id))).orderBy(asc(menuOptionSets.id))).map(row => row.id)
    expect(await found('SIZE')).toEqual(['s1'])
    expect(await found('s4')).toEqual(['s4'])
    expect(await found('%')).toEqual([])
    expect(await found(undefined)).toEqual(['s1', 's2', 's3', 's4'])
    expect(await found('')).toEqual(['s1', 's2', 's3', 's4'])
  })

  it('byName orders ignoring ASCII case', async () => {
    const rows = await db.select({ name: menuOptionSets.name }).from(menuOptionSets).where(inTenant(menuOptionSets, 'ours')).orderBy(byName(menuOptionSets.name), asc(menuOptionSets.id))
    expect(rows.map(row => row.name)).toEqual(['Beans', 'Ice', 'Milk', 'size'])
  })
})

describe('reads', () => {
  it('readPage returns a page and the total in one batch; past the end is empty with the total', async () => {
    const where = inTenant(menuOptionSets, 'ours')
    const read = (page: number) => readPage(db, db.select(setColumns).from(menuOptionSets).where(where).orderBy(byName(menuOptionSets.name), asc(menuOptionSets.id)).$dynamic(),
      db.select({ total: count() }).from(menuOptionSets).where(where), { page, pageSize: 3 })
    expect(await read(1)).toEqual({ total: 4, rows: [
      { id: 's4', name: 'Beans', status: 'active', version: 1 },
      { id: 's3', name: 'Ice', status: 'archived', version: 1 },
      { id: 's2', name: 'Milk', status: 'active', version: 1 },
    ] })
    expect(await read(2)).toEqual({ total: 4, rows: [{ id: 's1', name: 'size', status: 'active', version: 1 }] })
    expect(await read(3)).toEqual({ total: 4, rows: [] })
  })

  it('withPage limits a dynamic query', async () => {
    const rows = await withPage(db.select({ id: menuOptionSets.id }).from(menuOptionSets).where(inTenant(menuOptionSets, 'ours')).orderBy(desc(menuOptionSets.id)).$dynamic(), { page: 2, pageSize: 2 })
    expect(rows.map(row => row.id)).toEqual(['s2', 's1'])
  })

  it('hasAny and nextPosition read only what the condition names', async () => {
    expect(await hasAny(db, menuOptionSets, byId(menuOptionSets, 'ours', 's1'))).toBe(true)
    expect(await hasAny(db, menuOptionSets, byId(menuOptionSets, 'ours', 't1'))).toBe(false)
    await runBatch(db, insertAll(db, menuOptionValues, [...values('ours', 's1', 3), ...values('theirs', 't1', 1, 9)]), stale)
    expect(await nextPosition(db, menuOptionValues, menuOptionValues.sortOrder, inTenant(menuOptionValues, 'ours', eq(menuOptionValues.setId, 's1')))).toBe(4)
    expect(await nextPosition(db, menuOptionValues, menuOptionValues.sortOrder, inTenant(menuOptionValues, 'ours', eq(menuOptionValues.setId, 's2')))).toBe(1)
  })
})

describe('statements', () => {
  it('updateAtVersion changes the row at its version and moves the version on', async () => {
    await runBatch(db, [updateAtVersion(db, menuOptionSets, { tenantId: 'ours', id: 's1', version: 1 }, { name: 'Size', updatedAt: now }), requireOneChange(db)], stale)
    expect(await firstRow(db.select(setColumns).from(menuOptionSets).where(byId(menuOptionSets, 'ours', 's1')))).toEqual({ id: 's1', name: 'Size', status: 'active', version: 2 })
  })

  it('updateAtVersion changes nothing at a stale version, for another cafe\'s id, or when `extra` fails', async () => {
    const tries = [
      updateAtVersion(db, menuOptionSets, { tenantId: 'ours', id: 's2', version: 2 }, { name: 'Stale' }),
      updateAtVersion(db, menuOptionSets, { tenantId: 'ours', id: 't1', version: 1 }, { name: 'Theirs' }),
      updateAtVersion(db, menuOptionSets, { tenantId: 'ours', id: 's3', version: 1 }, { name: 'Archived' }, eq(menuOptionSets.status, 'active')),
    ]
    for (const statement of tries) await expect(runBatch(db, [statement, requireOneChange(db)], stale)).rejects.toThrow('stale')
    expect((await setsOf('ours')).map(row => [row.name, row.version])).toEqual([['size', 1], ['Milk', 1], ['Ice', 1], ['Beans', 1]])
    expect(await setsOf('theirs')).toEqual([{ id: 't1', name: 'Size', status: 'active', version: 1 }])
  })

  it('insertAll splits rows under D1\'s parameter limit (the test database refuses more), and makes no statement for none', async () => {
    expect(insertAll(db, menuOptionValues, [])).toEqual([])
    const statements = insertAll(db, menuOptionValues, values('ours', 's1', 60))
    expect(statements.length).toBeGreaterThan(1)
    await runBatch(db, statements, stale)
    expect(await db.$count(menuOptionValues, inTenant(menuOptionValues, 'ours'))).toBe(60)
  })

  it('replaceAll deletes only what `where` names, then inserts', async () => {
    await runBatch(db, insertAll(db, menuOptionValues, [...values('ours', 's1', 5), ...values('theirs', 't1', 2)]), stale)
    await runBatch(db, replaceAll(db, menuOptionValues, inTenant(menuOptionValues, 'ours', eq(menuOptionValues.setId, 's1')), values('ours', 's1', 2, 20)), stale)
    expect((await db.select({ id: menuOptionValues.id }).from(menuOptionValues).where(inTenant(menuOptionValues, 'ours')).orderBy(asc(menuOptionValues.sortOrder))).map(row => row.id)).toEqual(['s1-v20', 's1-v21'])
    expect(await db.$count(menuOptionValues, inTenant(menuOptionValues, 'theirs'))).toBe(2)
  })

  it('deleteOldest removes at most `limit` matching rows, first by the order, and says how many', async () => {
    await runBatch(db, insertAll(db, menuOptionValues, [...values('ours', 's1', 5), ...values('theirs', 't1', 5)]), stale)
    const oldest = () => deleteOldest(db, menuOptionValues, menuOptionValues.id, inTenant(menuOptionValues, 'ours'), [asc(menuOptionValues.sortOrder)], 2)
    expect(await oldest()).toBe(2)
    expect((await db.select({ sortOrder: menuOptionValues.sortOrder }).from(menuOptionValues).where(inTenant(menuOptionValues, 'ours')).orderBy(asc(menuOptionValues.sortOrder))).map(row => row.sortOrder)).toEqual([3, 4, 5])
    expect(await oldest()).toBe(2)
    expect(await oldest()).toBe(1)
    expect(await oldest()).toBe(0)
    expect(await db.$count(menuOptionValues, inTenant(menuOptionValues, 'theirs'))).toBe(5)
  })

  it('a guard counts with db.$count and the same conditions as the reads', async () => {
    const active = (tenantId: string) => inTenant(menuOptionSets, tenantId, eq(menuOptionSets.status, 'active'))
    await runBatch(db, [requireCount(db, db.$count(menuOptionSets, active('ours')), 3)], stale)
    await expect(runBatch(db, [
      updateAtVersion(db, menuOptionSets, { tenantId: 'ours', id: 's1', version: 1 }, { status: 'archived' }),
      requireCount(db, db.$count(menuOptionSets, and(active('ours'))), 3),
    ], stale)).rejects.toThrow('stale')
    expect(await db.$count(menuOptionSets, active('ours'))).toBe(3)
  })
})
