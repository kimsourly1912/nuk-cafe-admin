import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'
import type { Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import type { Db } from '#server/utils/batch'
import { eq } from 'drizzle-orm'
import { user } from '#server/db/tables'

const migrationsDir = fileURLToPath(new URL('../../../server/db/migrations/sqlite', import.meta.url))

/** D1 refuses a statement with more bound parameters than this ("too many SQL variables"); libsql allows 32,766. */
export const D1_MAX_PARAMS = 100

type Stmt = string | { sql: string, args?: unknown[] | Record<string, unknown> }
const paramCount = (stmt: Stmt) => typeof stmt === 'string' ? 0 : Array.isArray(stmt.args) ? stmt.args.length : Object.keys(stmt.args ?? {}).length

function checkParams(stmt: Stmt) {
  const n = paramCount(stmt)
  if (n > D1_MAX_PARAMS) throw new Error(`too many SQL variables: ${n} bound parameters (D1 allows ${D1_MAX_PARAMS}) in: ${typeof stmt === 'string' ? stmt : stmt.sql.slice(0, 120)}`)
}

/** The client, refusing what D1 refuses: more than 100 bound parameters in one statement. */
function likeD1(client: Client): Client {
  return new Proxy(client, {
    get(target, key, receiver) {
      if (key === 'execute') {
        return (stmt: Stmt, args?: unknown[]) => {
          checkParams(args ? { sql: stmt as string, args } : stmt)
          return target.execute(stmt as never, args as never)
        }
      }
      if (key === 'batch') {
        return (stmts: Stmt[], mode?: unknown) => {
          stmts.forEach(checkParams)
          return target.batch(stmts as never, mode as never)
        }
      }
      const value = Reflect.get(target, key, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/**
 * A fresh in-memory SQLite database with every checked-in migration applied, in the same
 * snake_case mode NuxtHub uses. Foreign keys are enforced, as they always are on D1, and so is
 * D1's limit of 100 bound parameters per statement.
 */
export async function createTestDb(): Promise<Db> {
  const client = await createTestClient()
  for (const file of migrationFiles()) await applyMigration(client, file)
  return drizzle({ client, casing: 'snake_case' })
}

/** An empty in-memory database like `createTestDb`'s (foreign keys on, D1's parameter limit), no migrations. */
export async function createTestClient(): Promise<Client> {
  const client = likeD1(createClient({ url: ':memory:' }))
  await client.execute('PRAGMA foreign_keys = ON')
  return client
}

/** The checked-in migration files, in order (`0000_initial.sql`, …). */
export const migrationFiles = () => readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()

/** Runs one migration file statement by statement, as NuxtHub does. */
export async function applyMigration(client: Client, file: string) {
  const statements = readFileSync(`${migrationsDir}/${file}`, 'utf8').split('--> statement-breakpoint')
  for (const statement of statements) {
    if (statement.trim()) await client.execute(statement)
  }
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
