import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { member } from '#server/db/tables'
import { replaceAccessStatements } from '#server/features/identity/staff.repository'
import { applyMigration, createTestClient, createTestDb, createUser, ensureTenant, migrationFiles } from '#server/tests/support/db'
import type { Db, Statement } from '#server/utils/batch'

// 0040: one membership per person and cafe, enforced by the database (the staff list joins `member`).

const MIGRATION = '0040_member_unique_index.sql'
const insertMember = 'INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)'
const duplicateMember = /UNIQUE constraint failed: member\.organization_id, member\.user_id/

describe('the migration, from a database that already has duplicates', () => {
  it('keeps one row per person and cafe (the owner first, then the oldest, then the lowest id), leaves the rest, and then refuses a second', async () => {
    const client = await createTestClient()
    for (const file of migrationFiles().filter(f => f < MIGRATION)) await applyMigration(client, file)
    for (const id of ['o1', 'o2']) await client.execute({ sql: 'INSERT INTO organization (id, name, slug, created_at) VALUES (?, ?, ?, 1)', args: [id, id, id] })
    for (const id of ['u1', 'u2', 'u3']) await client.execute({ sql: 'INSERT INTO user (id, name, email) VALUES (?, ?, ?)', args: [id, id, `${id}@example.com`] })
    const members: [string, string, string, string, number][] = [
      // u1 in o1: a newer owner row beats an older member row.
      ['m1', 'o1', 'u1', 'member', 100],
      ['m2', 'o1', 'u1', 'owner', 200],
      // u2 in o1: the same moment, the lowest id stays.
      ['m4', 'o1', 'u2', 'member', 100],
      ['m3', 'o1', 'u2', 'member', 100],
      // u3 in o1: the older row stays.
      ['m5', 'o1', 'u3', 'member', 300],
      ['m6', 'o1', 'u3', 'member', 100],
      // The same people in another cafe, once each: untouched.
      ['m7', 'o2', 'u1', 'member', 100],
      ['m8', 'o2', 'u2', 'member', 100],
    ]
    for (const row of members) await client.execute({ sql: insertMember, args: row })

    await applyMigration(client, MIGRATION)

    const left = await client.execute('SELECT id FROM member ORDER BY id')
    expect(left.rows.map(row => row.id)).toEqual(['m2', 'm3', 'm6', 'm7', 'm8'])
    await expect(client.execute({ sql: insertMember, args: ['m9', 'o1', 'u1', 'member', 1] })).rejects.toThrow(duplicateMember)
  })

  it('changes nothing when there are no duplicates', async () => {
    const client = await createTestClient()
    for (const file of migrationFiles().filter(f => f < MIGRATION)) await applyMigration(client, file)
    await client.execute({ sql: 'INSERT INTO organization (id, name, slug, created_at) VALUES (?, ?, ?, 1)', args: ['o1', 'o1', 'o1'] })
    await client.execute({ sql: 'INSERT INTO user (id, name, email) VALUES (?, ?, ?)', args: ['u1', 'u1', 'u1@example.com'] })
    await client.execute({ sql: insertMember, args: ['m1', 'o1', 'u1', 'owner', 1] })

    await applyMigration(client, MIGRATION)

    expect((await client.execute('SELECT id FROM member')).rows.map(row => row.id)).toEqual(['m1'])
  })
})

describe('the database', () => {
  async function setup(): Promise<{ db: Db, userId: string }> {
    const db = await createTestDb()
    await ensureTenant(db, 'tenant-1')
    await ensureTenant(db, 'tenant-2')
    return { db, userId: (await createUser(db)).id }
  }
  const row = (tenantId: string, userId: string, role = 'member') => ({ id: crypto.randomUUID(), organizationId: tenantId, userId, role, createdAt: new Date() })

  it('refuses a second membership of the same person in the same cafe, and allows one in another cafe', async () => {
    const { db, userId } = await setup()
    await db.insert(member).values(row('tenant-1', userId))
    await expect(db.insert(member).values(row('tenant-1', userId, 'owner'))).rejects.toMatchObject({ cause: { message: expect.stringMatching(duplicateMember) } })
    await db.insert(member).values(row('tenant-2', userId))
    expect(await db.select().from(member).where(eq(member.userId, userId))).toHaveLength(2)
  })

  it('still lets staff access be replaced again and again: the delete and the insert are one batch', async () => {
    const { db, userId } = await setup()
    for (const role of ['member', 'owner', 'member'] as const) {
      await db.batch(replaceAccessStatements(db, 'tenant-1', userId, role, [], new Date()) as [Statement, ...Statement[]])
    }
    expect(await db.select({ role: member.role }).from(member).where(and(eq(member.organizationId, 'tenant-1'), eq(member.userId, userId)))).toEqual([{ role: 'member' }])
  })
})
