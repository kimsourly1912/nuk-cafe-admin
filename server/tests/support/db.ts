import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import type { Db } from '../../utils/batch'
import { eq } from 'drizzle-orm'
import { user } from '../../db/tables'

const migrationsDir = fileURLToPath(new URL('../../../server/db/migrations/sqlite', import.meta.url))

/**
 * A fresh in-memory SQLite database with every checked-in migration applied, in the same
 * snake_case mode NuxtHub uses. Foreign keys are enforced, as they always are on D1.
 */
export async function createTestDb(): Promise<Db> {
  const client = createClient({ url: ':memory:' })
  await client.execute('PRAGMA foreign_keys = ON')
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
  for (const file of files) {
    const statements = readFileSync(`${migrationsDir}/${file}`, 'utf8').split('--> statement-breakpoint')
    for (const statement of statements) {
      if (statement.trim()) await client.execute(statement)
    }
  }
  return drizzle({ client, casing: 'snake_case' })
}

let users = 0

/** A Better Auth user row (what sign-up creates). */
export async function createUser(db: Db, email = `user${++users}@example.com`, name = 'Test User') {
  const rows: { id: string, email: string }[] = await db.insert(user).values({ id: crypto.randomUUID(), email, name }).returning({ id: user.id, email: user.email })
  return rows[0]!
}

/** A platform admin (Better Auth's `user.role`). */
export async function createAdmin(db: Db, email?: string) {
  const row = await createUser(db, email, 'Admin')
  await db.update(user).set({ role: 'admin' }).where(eq(user.id, row.id))
  return { userId: row.id, email: row.email }
}
