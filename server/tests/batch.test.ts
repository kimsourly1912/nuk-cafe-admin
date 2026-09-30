import { createClient } from '@libsql/client'
import { eq, sql } from 'drizzle-orm'
import { integer, sqliteTable } from 'drizzle-orm/sqlite-core'
import { drizzle as drizzleD1 } from 'drizzle-orm/d1'
import { drizzle } from 'drizzle-orm/libsql'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '#server/utils/batch'
import { isForeignKeyError, isStaleWrite, isUniqueViolation, requireCount, requireOneChange, runBatch } from '#server/utils/batch'
import { versionConflict } from '#server/utils/errors'

let db: Db
beforeEach(async () => {
  const client = createClient({ url: ':memory:' })
  await client.execute('PRAGMA foreign_keys = ON')
  await client.execute('create table things (id text primary key, name text not null, version integer not null)')
  await client.execute('create table notes (id text primary key, thing_id text not null references things(id), text text not null unique)')
  await client.execute(`insert into things values ('a', 'A', 1)`)
  db = drizzle({ client, casing: 'snake_case' })
})

const names = async () => (await db.all<{ name: string }>(sql`select name from things order by id`)).map(r => r.name)
const notes = async () => (await db.all<{ text: string }>(sql`select text from notes`)).map(r => r.text)
const update = (version: number, name: string) => db.run(sql`update things set name = ${name}, version = version + 1 where id = 'a' and version = ${version}`)
const addNote = (text: string) => db.run(sql`insert into notes values (${text}, 'a', ${text})`)

describe('requireOneChange', () => {
  it('lets the batch apply when the conditional update matched', async () => {
    await runBatch(db, [update(1, 'B'), requireOneChange(db), addNote('changed')], () => versionConflict('The thing'))
    expect(await names()).toEqual(['B'])
    expect(await notes()).toEqual(['changed'])
  })

  it('rolls back everything, before and after it, when the update matched nothing', async () => {
    const run = runBatch(db, [addNote('before'), update(7, 'B'), requireOneChange(db), addNote('after')], () => versionConflict('The thing'))
    await expect(run).rejects.toMatchObject({ statusCode: 409, data: { code: 'VERSION_CONFLICT' } })
    expect(await names()).toEqual(['A'])
    expect(await notes()).toEqual([])
  })
})

describe('requireCount', () => {
  it('aborts the batch when the count differs', async () => {
    const count = sql`select count(*) from things`
    await runBatch(db, [requireCount(db, count, 1), addNote('ok')], () => new Error('stale'))
    await expect(runBatch(db, [requireCount(db, count, 2), addNote('no')], () => new Error('stale'))).rejects.toThrow('stale')
    expect(await notes()).toEqual(['ok'])
  })
})

describe('error classification', () => {
  it('recognizes guard, foreign key and unique failures', async () => {
    const stale = await db.batch([update(9, 'x'), requireOneChange(db)]).catch(e => e)
    expect(isStaleWrite(stale)).toBe(true)
    const fk = await db.run(sql`insert into notes values ('n', 'missing', 'n')`).catch(e => e)
    expect(isForeignKeyError(fk)).toBe(true)
    await addNote('dup')
    const unique = await db.run(sql`insert into notes values ('n2', 'a', 'dup')`).catch(e => e)
    expect(isUniqueViolation(unique)).toBe(true)
    expect(isStaleWrite(fk)).toBe(false)
  })

  it('passes other errors through runBatch unchanged', async () => {
    await expect(runBatch(db, [db.run(sql`insert into notes values ('n', 'missing', 'n')`)], () => versionConflict('x')))
      .rejects.toSatisfy((e: unknown) => isForeignKeyError(e))
  })
})

describe('on D1', () => {
  /**
   * Drizzle's D1 driver against a stand-in D1 client that records what it's asked to run. The real
   * D1 answered the old raw-SQL guards with "Cannot read properties of undefined (reading 'bind')"
   * as soon as a guard had a bound parameter (staging, D53); libsql never showed it.
   */
  function fakeD1() {
    const bound: { sql: string, params: unknown[] }[] = []
    const statement = (text: string) => ({
      bind: (...params: unknown[]) => {
        const entry = { sql: text, params }
        bound.push(entry)
        return { ...entry, all: async () => ({ results: [] }), raw: async () => [], run: async () => ({ results: [] }), first: async () => null }
      },
    })
    const client = {
      prepare: (text: string) => statement(text),
      batch: async (statements: unknown[]) => statements.map(() => ({ results: [], success: true, meta: {} })),
    }
    return { db: drizzleD1(client as never) as unknown as Db, bound }
  }

  const things = sqliteTable('t', { v: integer() })

  it('batches every guard, with and without bound parameters', async () => {
    const { db: d1, bound } = fakeD1()
    await d1.batch([
      d1.update(things).set({ v: 1 }).where(eq(things.v, 0)),
      requireOneChange(d1),
      requireCount(d1, sql`select count(*) from t where kind = ${'admin'}`, 1),
    ])
    expect(bound.map(b => b.params)).toEqual([[1, 0], [], ['admin', 1]])
    expect(bound[2]!.sql).toContain('json(\'stale write\')')
  })
})
