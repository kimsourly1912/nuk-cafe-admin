import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { eq } from 'drizzle-orm'
import { user } from '../../../server/db/tables'
import { createTable, updateBranchSettings } from '../../../server/features/branches'
import type { Actor } from '../../../server/features/identity'
import { createStaff } from '../../../server/features/identity'
import { createCategory, createItem, publishItem } from '../../../server/features/menu'
import { loadSampleMenuStep } from '../../../server/features/sample-data'
import { createTestAuth } from '../../../server/tests/support/auth'
import { applyMigration, createAdmin, ensureTenant, insertBranch, migrationFiles, TEST_TENANT } from '../../../server/tests/support/db'
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
  /**
   * Customers: verified, not verified yet, one whose password a test resets, and for checkout
   * (D100) three verified shoppers and one unverified (each test places its own orders: one
   * customer may have 2 unpaid at a time). Tests that change a customer (verify, reset) own it:
   * files run in any order, so no other file may rely on its state (`apiUnverified` is
   * shop-orders-api's, since shop-account verifies `unverified`).
   */
  customers: Record<'verified' | 'unverified' | 'reset' | 'shopperA' | 'shopperB' | 'shopperC' | 'shopperUnverified' | 'apiUnverified' | 'counterCustomer' | 'counterShopperA' | 'counterShopperB' | 'cashier' | 'tracker' | 'followerA' | 'followerB' | 'followerC' | 'tableGuest' | 'cafeHopper', SeedCustomer>
  /** A second table at Riverside (T02), for tests that archive it. */
  spareTableToken: string
  /**
   * Another cafe (D141), `/c/brown-bean`: one branch open around the clock, one item and a table,
   * for the tests that check each cafe's address shows only its own.
   */
  secondCafe: { slug: string, name: string, branchId: string, itemName: string, tableToken: string }
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
  shopperA: { name: 'Bopha Lim', email: 'bopha@example.com', password: 'long-enough-password-4' },
  shopperB: { name: 'Chenda Ou', email: 'chenda@example.com', password: 'long-enough-password-5' },
  shopperC: { name: 'Rith Men', email: 'rith@example.com', password: 'long-enough-password-6' },
  shopperUnverified: { name: 'Nary Heng', email: 'nary@example.com', password: 'long-enough-password-7' },
  apiUnverified: { name: 'Mealea Chea', email: 'mealea@example.com', password: 'long-enough-password-8' },
  counterCustomer: { name: 'Pisey Ly', email: 'pisey@example.com', password: 'long-enough-password-9' },
  // The counter app's tests (6.3b) place orders as these two (2 unpaid at most each).
  counterShopperA: { name: 'Sreyneang Heng', email: 'sreyneang@example.com', password: 'long-enough-password-11' },
  counterShopperB: { name: 'Kimheng Sok', email: 'kimheng@example.com', password: 'long-enough-password-12' },
  // Tracking's API tests (6.5a) list and cancel this customer's orders.
  tracker: { name: 'Ratha Pen', email: 'ratha@example.com', password: 'long-enough-password-13' },
  // The tracking pages' tests (6.5b) follow, cancel and list these customers' orders.
  followerA: { name: 'Sophal Chea', email: 'sophal@example.com', password: 'long-enough-password-14' },
  followerB: { name: 'Leakena Tan', email: 'leakena@example.com', password: 'long-enough-password-15' },
  followerC: { name: 'Visal Ung', email: 'visal@example.com', password: 'long-enough-password-16' },
  // The release check (10.5): signs in from a table's QR link and places a dine-in order.
  tableGuest: { name: 'Chanthy Nob', email: 'chanthy@example.com', password: 'long-enough-password-17' },
  // Two cafes (D141): orders at Brown Bean, checked to stay out of NUK Cafe's.
  cafeHopper: { name: 'Malis Prum', email: 'malis@example.com', password: 'long-enough-password-18' },
  // Not a customer: the counter's cashier (step 6.3), staff at Riverside.
  cashier: { name: 'Sophea Keo', email: 'sophea@example.com', password: 'long-enough-password-10' },
}

async function addBranch(db: Db, name: string, tenantId = TEST_TENANT) {
  const id = crypto.randomUUID()
  await insertBranch(db, { id, name, timezone: 'Asia/Phnom_Penh', tenantId })
  return id
}

const ALL_DAY = [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, startMinute: 0, endMinute: 1440 }))

/** Brown Bean (D141): its own owner, branch, menu and table, nothing shared with NUK Cafe. */
async function seedSecondCafe(db: Db, qr: { secret: string, baseUrl: string }): Promise<ShopSeed['secondCafe']> {
  const cafe = { id: 'tenant-2', slug: 'brown-bean', name: 'Brown Bean' }
  await ensureTenant(db, cafe.id, cafe.slug)
  const owner = await createAdmin(db, 'owner@brown-bean.example', cafe.id)
  const actor: Actor = { userId: owner.userId, tenantId: cafe.id, role: 'owner' }
  const branchId = await addBranch(db, 'Bean Street', cafe.id)
  await updateBranchSettings(db, actor, branchId, { version: 1, hours: ALL_DAY })
  const category = await createCategory(db, actor, { name: 'Beans', description: '', parentId: null, availabilityRuleIds: [] })
  const itemName = 'Brown Bean Latte'
  const draft = await createItem(db, actor, { categoryId: category.id, name: itemName, description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 300, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] })
  await publishItem(db, actor, draft.id, { version: draft.version })
  const table = await createTable(db, actor, branchId, { label: 'B1', area: null }, qr)
  return { slug: cafe.slug, name: cafe.name, branchId, itemName, tableToken: tokenOf(table.qrUrl) }
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

  // The cafe (a tenant, D134) at NUK Cafe's address, the one the app works in (`nuk`, D140), and its owner.
  await ensureTenant(db, TEST_TENANT, 'nuk')
  const admin = await createAdmin(db, 'e2e-admin@example.com')
  const actor: Actor = { userId: admin.userId, tenantId: TEST_TENANT, role: 'owner' }
  const openBranchId = await addBranch(db, 'Riverside')
  const closedBranchId = await addBranch(db, 'Zeta Kiosk')

  // Open around the clock, so tests don't depend on the time they run at.
  await updateBranchSettings(db, actor, openBranchId, { version: 1, hours: ALL_DAY })

  for (let steps = 0; ; steps++) {
    const state = await loadSampleMenuStep(db, actor, { size: 'standard' }, 'E2E')
    if (state.menu.run?.finished) break
    if (steps > 100) throw new Error('The sample menu never finished loading')
  }

  const qr = { secret: qrSecret, baseUrl: 'http://e2e.local' }
  const openTable = await createTable(db, actor, openBranchId, { label: 'T01', area: 'Main floor' }, qr)
  const closedTable = await createTable(db, actor, closedBranchId, { label: 'K01', area: null }, qr)
  const spareTable = await createTable(db, actor, openBranchId, { label: 'T02', area: 'Main floor' }, qr)
  const secondCafe = await seedSecondCafe(db, qr)
  // Created as a visitor would (hashed password, customer profile, a queued verification email), but
  // without the breached-password lookup (an external API). Their queued emails carry test links.
  const auth = createTestAuth(db)
  for (const customer of Object.values(CUSTOMERS)) await auth.api.signUpEmail({ body: customer })
  for (const customer of [CUSTOMERS.verified, CUSTOMERS.reset, CUSTOMERS.shopperA, CUSTOMERS.shopperB, CUSTOMERS.shopperC, CUSTOMERS.counterCustomer, CUSTOMERS.counterShopperA, CUSTOMERS.counterShopperB, CUSTOMERS.tracker, CUSTOMERS.followerA, CUSTOMERS.followerB, CUSTOMERS.followerC, CUSTOMERS.tableGuest, CUSTOMERS.cafeHopper, CUSTOMERS.cashier]) {
    await db.update(user).set({ emailVerified: true }).where(eq(user.email, customer.email))
  }
  // An existing account keeps its password when it's given branch access (D49).
  await createStaff(db, actor, { name: CUSTOMERS.cashier.name, email: CUSTOMERS.cashier.email, admin: false, memberships: [{ branchId: openBranchId, role: 'staff' }] })
  await client.execute('delete from outbox_messages')

  client.close()
  return { dbFile, customers: CUSTOMERS, secondCafe, spareTableToken: tokenOf(spareTable.qrUrl), openBranchId, closedBranchId, openTableToken: tokenOf(openTable.qrUrl), closedTableToken: tokenOf(closedTable.qrUrl) }
}
