import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'
import type { Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import type { Db } from '#server/utils/batch'
import { and, eq } from 'drizzle-orm'
import { branches, branchStaff, member, organization, user } from '#server/db/tables'
import { tenantSlugs } from '#server/features/tenants/tenants.schema'

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

/** The tenant tests act in (D134): `ensureTenant` creates it, actors name it. */
export const TEST_TENANT = 'tenant-1'

/** A tenant (a Better Auth organization), once per database. */
export async function ensureTenant(db: Db, id = TEST_TENANT, slug = id) {
  await db.insert(organization).values({ id, name: `Cafe ${id}`, slug, status: 'active', createdAt: new Date() }).onConflictDoNothing()
  // Its address in the address history, as the platform console keeps it (D142).
  await db.insert(tenantSlugs).values({ slug, tenantId: id }).onConflictDoNothing()
  return id
}

/** A branch of a tenant (`TEST_TENANT` unless named), creating the tenant if needed. */
export async function insertBranch(db: Db, values: { id: string, name: string, timezone: string, status?: string | null, tenantId?: string, address?: string | null, phone?: string | null }) {
  const tenantId = await ensureTenant(db, values.tenantId)
  await db.insert(branches).values({ ...values, tenantId, status: (values.status ?? 'active') as 'active' | 'archived', createdAt: new Date() })
}

/** An owner of the tenant (`TEST_TENANT` unless named): the admin app's user (D52, D134). */
export async function createAdmin(db: Db, email?: string, tenantId = TEST_TENANT) {
  const row = await createUser(db, email, 'Admin')
  await ensureTenant(db, tenantId)
  await db.insert(member).values({ id: crypto.randomUUID(), organizationId: tenantId, userId: row.id, role: 'owner', createdAt: new Date() })
  return { userId: row.id, email: row.email }
}

/** Someone working at a branch (`manager` or `staff`): a member of its tenant with a `branch_staff` row (D134). */
export async function addBranchStaff(db: Db, branchId: string, userId: string, role: string, tenantId = TEST_TENANT) {
  const [known] = await db.select({ id: member.id }).from(member).where(and(eq(member.organizationId, tenantId), eq(member.userId, userId)))
  if (!known) await db.insert(member).values({ id: crypto.randomUUID(), organizationId: tenantId, userId, role: 'member', createdAt: new Date() })
  await db.insert(branchStaff).values({ tenantId, branchId, userId, role: role as 'manager' | 'staff', createdAt: new Date() })
}
