import { createClient } from '@libsql/client'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../utils/batch'
import { isForeignKeyError, isStaleWrite, isUniqueViolation, requireCount, requireOneChange, runBatch } from '../utils/batch'
import { versionConflict } from '../utils/errors'

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
