import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { eq } from 'drizzle-orm'
import { organization, user } from '../../../server/db/tables'
import { createTable, updateBranchSettings } from '../../../server/features/branches'
import type { Actor } from '../../../server/features/identity'
import { loadSampleMenuStep } from '../../../server/features/sample-data'
import { createTestAuth } from '../../../server/tests/support/auth'
import { applyMigration, createAdmin, migrationFiles } from '../../../server/tests/support/db'
import type { Db } from '../../../server/utils/batch'

/**
 * The e2e server's own database (D95): the customer site renders on the server, so its tests need
 * real data, not browser mocks. Rebuilt from the checked-in migrations before every run and filled
 * through the real services, with the Standard sample menu (D94), so tests read the same catalog an
 * admin loads: one branch always open, one with no hours (closed), and a table in each; and
 * customer accounts for the account pages (step 5.2), one per test that changes its account.
 * The admin tests don't use it (the admin renders in the browser, against `mockApi`).
 */

export interface ShopSeed {
  /** Always open ("Riverside"): the first branch by name, the one the menu shows by default. */
  openBranchId: string
  /** No opening hours ("Zeta Kiosk"): closed. */
  closedBranchId: string
  /** QR tokens of table T01 at Riverside and K01 at Zeta Kiosk. */
  openTableToken: string
  closedTableToken: string
  /** The database file, for reading the account emails the server queued (the outbox). */
  dbFile: string
  /** Customers: verified, not verified yet, and one whose password a test resets. */
  customers: Record<'verified' | 'unverified' | 'reset', SeedCustomer>
}

export interface SeedCustomer {
  name: string
  email: string
  password: string
}

const CUSTOMERS: ShopSeed['customers'] = {
  verified: { name: 'Dara Sok', email: 'dara@example.com', password: 'long-enough-password-1' },
  unverified: { name: 'Sokha Chan', email: 'sokha@example.com', password: 'long-enough-password-2' },
  reset: { name: 'Vanna Kim', email: 'vanna@example.com', password: 'long-enough-password-3' },
}

async function addBranch(db: Db, name: string) {
  const id = crypto.randomUUID()
  await db.insert(organization).values({ id, name, slug: name.toLowerCase().replaceAll(' ', '-'), timezone: 'Asia/Phnom_Penh', status: 'active', createdAt: new Date() })
  return id
}

const tokenOf = (qrUrl: string | null) => qrUrl!.split('/').pop()!

export async function seedShop(dbFile: string, qrSecret: string): Promise<ShopSeed> {
  for (const file of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
    if (existsSync(file)) rmSync(file)
  }
  mkdirSync(dirname(dbFile), { recursive: true })
  const client = createClient({ url: `file:${dbFile}` })
  await client.execute('PRAGMA foreign_keys = ON')
  for (const file of migrationFiles()) await applyMigration(client, file)
  const db: Db = drizzle({ client, casing: 'snake_case' })

  const admin = await createAdmin(db, 'e2e-admin@example.com')
  const actor: Actor = { userId: admin.userId, role: 'admin' }
  const openBranchId = await addBranch(db, 'Riverside')
  const closedBranchId = await addBranch(db, 'Zeta Kiosk')

  // Open around the clock, so tests don't depend on the time they run at.
  const allDay = [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, startMinute: 0, endMinute: 1440 }))
  await updateBranchSettings(db, actor, openBranchId, { version: 1, hours: allDay })

  for (let steps = 0; ; steps++) {
    const state = await loadSampleMenuStep(db, actor, { size: 'standard' }, 'E2E')
    if (state.menu.run?.finished) break
    if (steps > 100) throw new Error('The sample menu never finished loading')
  }

  const qr = { secret: qrSecret, baseUrl: 'http://e2e.local' }
  const openTable = await createTable(db, actor, openBranchId, { label: 'T01', area: 'Main floor' }, qr)
  const closedTable = await createTable(db, actor, closedBranchId, { label: 'K01', area: null }, qr)
  // Created as a visitor would (hashed password, customer profile, a queued verification email), but
  // without the breached-password lookup (an external API). Their queued emails carry test links.
  const auth = createTestAuth(db)
  for (const customer of Object.values(CUSTOMERS)) await auth.api.signUpEmail({ body: customer })
  for (const customer of [CUSTOMERS.verified, CUSTOMERS.reset]) {
    await db.update(user).set({ emailVerified: true }).where(eq(user.email, customer.email))
  }
  await client.execute('delete from outbox_messages')

  client.close()
  return { dbFile, customers: CUSTOMERS, openBranchId, closedBranchId, openTableToken: tokenOf(openTable.qrUrl), closedTableToken: tokenOf(closedTable.qrUrl) }
}
