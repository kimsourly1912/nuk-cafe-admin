import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { eq } from 'drizzle-orm'
import { member, organization, user } from '../../../server/db/tables'
import { createTable, updateBranchSettings } from '../../../server/features/branches'
import type { Actor } from '../../../server/features/identity'
import { createStaff } from '../../../server/features/identity'
import { createCategory, createItem, createPromotion, publishItem } from '../../../server/features/menu'
import { saveBakongToken } from '../../../server/features/orders'
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
  /**
   * Open around the clock ("Zulu Pop-up", last by name), for pausing online orders (D199): no other
   * file orders there, so a pause never stops theirs.
   */
  popupBranchId: string
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
  customers: Record<'verified' | 'unverified' | 'reset' | 'shopperA' | 'shopperB' | 'shopperC' | 'shopperUnverified' | 'apiUnverified' | 'counterCustomer' | 'counterShopperA' | 'counterShopperB' | 'cashier' | 'tracker' | 'followerA' | 'followerB' | 'followerC' | 'followerD' | 'a11yGuest' | 'tableGuest' | 'cafeHopper' | 'beanOwner' | 'guestLinker' | 'budgetShopper' | 'leaver' | 'temporaryStaff' | 'manager' | 'popupManager' | 'twoStepCashier', SeedCustomer>
  /** A second table at Riverside (T02), for tests that archive it. */
  spareTableToken: string
  /**
   * Another cafe (D141), `/c/brown-bean`: one branch open around the clock, one item and a table,
   * for the tests that check each cafe's address shows only its own.
   */
  secondCafe: { slug: string, name: string, branchId: string, itemName: string, tableToken: string, promotionId: string }
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
  // Follows an order while the connection drops (shop-tracking.test.ts, D150).
  followerD: { name: 'Rotha Mao', email: 'rotha@example.com', password: 'long-enough-password-40' },
  /** Places the order the counter's accessibility check reads (accessibility.test.ts). */
  a11yGuest: { name: 'Kosal Ly', email: 'kosal@example.com', password: 'long-enough-password-41' },
  // The release check (10.5): signs in from a table's QR link and places a dine-in order.
  tableGuest: { name: 'Chanthy Nob', email: 'chanthy@example.com', password: 'long-enough-password-17' },
  // Two cafes (D141): orders at Brown Bean, checked to stay out of NUK Cafe's.
  cafeHopper: { name: 'Malis Prum', email: 'malis@example.com', password: 'long-enough-password-18' },
  // Orders as a guest, then signs in: the guest's order moves to this account (D156).
  guestLinker: { name: 'Dalin Hor', email: 'dalin@example.com', password: 'long-enough-password-42' },
  /** Only browses (request-budget-shop.test.ts): no orders, so nothing polls and the counts hold. */
  budgetShopper: { name: 'Narin Pech', email: 'narin@example.com', password: 'long-enough-password-43' },
  /** Deletes their account (shop-account.test.ts, D237): no other test may sign in as them. */
  leaver: { name: 'Kanha Leav', email: 'kanha@example.com', password: 'long-enough-password-47' },
  // Not a customer: Brown Bean's second owner, who signs in at NUK Cafe's admin by mistake (T2c, D144).
  beanOwner: { name: 'Bea Brown', email: 'bea@brown-bean.example', password: 'long-enough-password-19' },
  // Not a customer: the counter's cashier (step 6.3), staff at Riverside.
  cashier: { name: 'Sophea Keo', email: 'sophea@example.com', password: 'long-enough-password-10' },
  // Not a customer: staff at Riverside still on the temporary password an admin gave them, who
  // signs in on the store (shop-account.test.ts).
  temporaryStaff: { name: 'Davy Sam', email: 'davy@example.com', password: 'long-enough-password-44' },
  // Not a customer: Riverside's manager, with the counter's Manage tools (manager-tools.test.ts, D198).
  manager: { name: 'Mony Chan', email: 'mony@example.com', password: 'long-enough-password-45' },
  // Not a customer: Zulu Pop-up's manager, who pauses its online orders (pause-orders.test.ts, D199).
  popupManager: { name: 'Rina Sok', email: 'rina@example.com', password: 'long-enough-password-46' },
  // Not a customer: staff at Riverside who turns two-step sign-in on and off (two-factor.test.ts,
  // D242): no other test may sign in as them.
  twoStepCashier: { name: 'Bunna Phan', email: 'bunna@example.com', password: 'long-enough-password-48' },
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
  await db.update(organization).set({ name: cafe.name }).where(eq(organization.id, cafe.id))
  const owner = await createAdmin(db, 'owner@brown-bean.example', cafe.id)
  const actor: Actor = { userId: owner.userId, tenantId: cafe.id, role: 'owner' }
  const branchId = await addBranch(db, 'Bean Street', cafe.id)
  await updateBranchSettings(db, actor, branchId, { version: 1, hours: ALL_DAY })
  const category = await createCategory(db, actor, { name: 'Beans', description: '', parentId: null, availabilityRuleIds: [] })
  const itemName = 'Brown Bean Latte'
  const draft = await createItem(db, actor, { categoryId: category.id, name: itemName, description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 300, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] })
  await publishItem(db, actor, draft.id, { version: draft.version })
  // A promotion running all year on its whole menu (M1, D163): $3.00 → $2.40 for the customer's
  // promotion tests; Brown Bean's other tests read prices from the quote, never write them down.
  const promotion = await createPromotion(db, actor, { name: 'Bean week', description: 'Every drink 20% off.', discount: { kind: 'percent', percent: 20 }, scope: 'menu', itemIds: [], categoryIds: [], branchIds: [], startsOn: '2026-01-01', endsOn: null, posterId: null, publish: true })
  const table = await createTable(db, actor, branchId, { label: 'B1', area: null }, qr)
  return { slug: cafe.slug, name: cafe.name, branchId, itemName, tableToken: tokenOf(table.qrUrl), promotionId: promotion.id }
}

const tokenOf = (qrUrl: string | null) => qrUrl!.split('/').pop()!

export async function seedShop(dbFile: string, qrSecret: string, bakong: { encryptionKey: string, token: string }): Promise<ShopSeed> {
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
  await db.update(organization).set({ name: 'NUK Cafe' }).where(eq(organization.id, TEST_TENANT))
  // A cafe the platform paused (D142): its pages say so, by name (D143).
  await ensureTenant(db, 'tenant-3', 'quiet-corner')
  await db.update(organization).set({ name: 'Quiet Corner', status: 'suspended', suspendedReason: 'Unpaid invoice' }).where(eq(organization.id, 'tenant-3'))
  const admin = await createAdmin(db, 'e2e-admin@example.com')
  const actor: Actor = { userId: admin.userId, tenantId: TEST_TENANT, role: 'owner' }
  const openBranchId = await addBranch(db, 'Riverside')
  const closedBranchId = await addBranch(db, 'Zeta Kiosk')
  const popupBranchId = await addBranch(db, 'Zulu Pop-up')

  // Open around the clock, so tests don't depend on the time they run at.
  await updateBranchSettings(db, actor, openBranchId, { version: 1, hours: ALL_DAY })
  await updateBranchSettings(db, actor, popupBranchId, { version: 1, hours: ALL_DAY })

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
  // NUK Cafe's own Bakong token (T2d, D148), sealed with the e2e server's key: its counter checks
  // KHQRs with the stand-in for Bakong. Brown Bean has none.
  await saveBakongToken(db, actor, { version: 0, token: bakong.token }, { apiUrl: '', encryptionKey: bakong.encryptionKey })
  // Created as a visitor would (hashed password, customer profile, a queued verification email), but
  // without the breached-password lookup (an external API). Their queued emails carry test links.
  const auth = createTestAuth(db)
  for (const customer of Object.values(CUSTOMERS)) await auth.api.signUpEmail({ body: customer })
  for (const customer of [CUSTOMERS.verified, CUSTOMERS.reset, CUSTOMERS.shopperA, CUSTOMERS.shopperB, CUSTOMERS.shopperC, CUSTOMERS.counterCustomer, CUSTOMERS.counterShopperA, CUSTOMERS.counterShopperB, CUSTOMERS.tracker, CUSTOMERS.followerA, CUSTOMERS.followerB, CUSTOMERS.followerC, CUSTOMERS.followerD, CUSTOMERS.a11yGuest, CUSTOMERS.tableGuest, CUSTOMERS.cafeHopper, CUSTOMERS.guestLinker, CUSTOMERS.cashier, CUSTOMERS.beanOwner, CUSTOMERS.budgetShopper, CUSTOMERS.leaver, CUSTOMERS.manager, CUSTOMERS.popupManager, CUSTOMERS.twoStepCashier]) {
    await db.update(user).set({ emailVerified: true }).where(eq(user.email, customer.email))
  }
  // An existing account keeps its password when it's given branch access (D49).
  await createStaff(db, actor, { name: CUSTOMERS.cashier.name, email: CUSTOMERS.cashier.email, admin: false, memberships: [{ branchId: openBranchId, role: 'staff' }] })
  await createStaff(db, actor, { name: CUSTOMERS.popupManager.name, email: CUSTOMERS.popupManager.email, admin: false, memberships: [{ branchId: popupBranchId, role: 'manager' }] })
  await createStaff(db, actor, { name: CUSTOMERS.manager.name, email: CUSTOMERS.manager.email, admin: false, memberships: [{ branchId: openBranchId, role: 'manager' }] })
  await createStaff(db, actor, { name: CUSTOMERS.twoStepCashier.name, email: CUSTOMERS.twoStepCashier.email, admin: false, memberships: [{ branchId: openBranchId, role: 'staff' }] })
  await createStaff(db, actor, { name: CUSTOMERS.temporaryStaff.name, email: CUSTOMERS.temporaryStaff.email, admin: false, memberships: [{ branchId: openBranchId, role: 'staff' }] })
  await db.update(user).set({ mustChangePassword: true }).where(eq(user.email, CUSTOMERS.temporaryStaff.email))
  // Brown Bean's owner too (the platform console adds an existing account so, D142).
  const [bea] = await db.select({ id: user.id }).from(user).where(eq(user.email, CUSTOMERS.beanOwner.email))
  await db.insert(member).values({ id: crypto.randomUUID(), organizationId: 'tenant-2', userId: bea!.id, role: 'owner', createdAt: new Date() })
  await client.execute('delete from outbox_messages')

  client.close()
  return { dbFile, customers: CUSTOMERS, secondCafe, spareTableToken: tokenOf(spareTable.qrUrl), openBranchId, closedBranchId, popupBranchId, openTableToken: tokenOf(openTable.qrUrl), closedTableToken: tokenOf(closedTable.qrUrl) }
}
