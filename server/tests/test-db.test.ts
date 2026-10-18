import type { Client } from '@libsql/client'
import { sql } from 'drizzle-orm'
import type { Db } from '#server/utils/batch'
import { describe, expect, it } from 'vitest'
import { applyMigration, createTestClient, createTestDb, D1_MAX_PARAMS, dumpSchema, migrationFiles } from '#server/tests/support/db'

// `createTestDb` replays a dump of the migrated schema instead of every migration (D174). It must
// stay the same database the migrations build, so a new migration can't be silently missed.
async function migratedClient() {
  const client = await createTestClient()
  for (const file of migrationFiles()) await applyMigration(client, file)
  return client
}

async function contents(execute: (query: string) => Promise<{ rows: unknown[] }>) {
  const schema = (await execute(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`)).rows.map(row => ({ ...row as object }))
  const rows: Record<string, unknown[]> = {}
  for (const table of schema as { type: string, name: string }[]) {
    if (table.type === 'table') rows[table.name] = (await execute(`SELECT * FROM "${table.name}" ORDER BY rowid`)).rows.map(row => ({ ...row as object }))
  }
  return { schema, rows }
}

const ofClient = (client: Client) => contents(query => client.execute(query))
// `Db` is typed without its client; the libsql client is there at runtime.
const clientOf = (db: Db) => (db as unknown as { $client: Client }).$client

describe('createTestDb', () => {
  it('has exactly the schema and rows the migrations build', async () => {
    const db = await createTestDb()
    const expected = await ofClient(await migratedClient())
    expect(expected.schema.length).toBeGreaterThan(100)
    expect(await contents(query => clientOf(db).execute(query))).toEqual(expected)
  })

  it('enforces foreign keys and D1\'s parameter limit', async () => {
    const db = await createTestDb()
    expect((await clientOf(db).execute('PRAGMA foreign_keys')).rows[0]![0]).toBe(1)
    await expect(async () => clientOf(db).execute({ sql: `SELECT ${Array.from({ length: D1_MAX_PARAMS + 1 }, () => '?').join(', ')}`, args: Array.from({ length: D1_MAX_PARAMS + 1 }, () => 1) }))
      .rejects.toThrow(/too many SQL variables/)
  })

  it('gives every call its own database', async () => {
    const first = await createTestDb()
    const second = await createTestDb()
    await first.run(sql`CREATE TABLE only_here (id integer)`)
    expect((await clientOf(second).execute(`SELECT count(*) FROM sqlite_master WHERE name = 'only_here'`)).rows[0]![0]).toBe(0)
  })
})

describe('dumpSchema', () => {
  it('recreates rows a migration inserts, whatever their key order', async () => {
    const source = await migratedClient()
    // Today's migrations insert no rows; a future one may (a child row before its parent, here).
    await source.execute('PRAGMA foreign_keys = OFF')
    await source.execute(`INSERT INTO tenant_slugs (slug, tenant_id) VALUES ('later', 'org-later')`)
    await source.execute(`INSERT INTO organization (id, name, slug, status, created_at) VALUES ('org-later', 'Later', 'later', 'active', 1)`)
    const copy = await createTestClient()
    await copy.execute('PRAGMA foreign_keys = OFF')
    await copy.batch(await dumpSchema(source), 'write')
    expect(await ofClient(copy)).toEqual(await ofClient(source))
  })
})
