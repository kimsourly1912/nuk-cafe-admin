import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PlaceOrderInput } from '#shared/contracts/orders'
import { user } from '#server/db/tables'
import { updateBranchSettings } from '#server/features/branches'
import { customerProfiles } from '#server/features/customers/customers.schema'
import { authorizeCustomer, authorizeSignedIn, guestNameStatement } from '#server/features/identity'
import type { Actor, SessionUser } from '#server/features/identity'
import { createCategory, createItem, publishItem } from '#server/features/menu'
import { listCounterQueue } from '#server/features/orders/counter.service'
import { orders } from '#server/features/orders/orders.schema'
import { getOrder, listMyOrders, moveGuestOrders, placeOrder } from '#server/features/orders/orders.service'
import { createTestAuth, sessionHeaders } from '#server/tests/support/auth'
import type { TestAuth } from '#server/tests/support/auth'
import { createTestDb, createUser, ensureTenant, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import type { Db } from '#server/utils/batch'
import { newId } from '#server/utils/ids'

// Guest ordering (D156): Place order without an account signs the browser in as a guest (Better
// Auth's anonymous plugin). The order rules are the same; a guest names themselves for the counter;
// signing in or up later on that device moves their orders to the account.

let db: Db
let auth: TestAuth
const admin: Actor = { userId: 'admin-1', tenantId: TEST_TENANT, role: 'owner' }
let branchId: string
let bread: { id: string, variationId: string }

const NOON = new Date('2026-09-28T12:00:00+07:00')

beforeEach(async () => {
  db = await createTestDb()
  await ensureTenant(db)
  auth = createTestAuth(db)
  branchId = newId()
  await insertBranch(db, { id: branchId, name: 'Riverside', timezone: 'Asia/Phnom_Penh', status: 'active' })
  await updateBranchSettings(db, admin, branchId, { version: 1, hours: [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, startMinute: 420, endMinute: 1260 })) })
  const category = await createCategory(db, admin, { name: 'Bakery', description: '', parentId: null, availabilityRuleIds: [] })
  const draft = await createItem(db, admin, {
    categoryId: category.id,
    name: 'Banana Bread',
    description: '',
    imageId: null,
    optionSetIds: [],
    variations: [{ valueIds: [], priceMinor: 250, status: 'active' }],
    modifierGroups: [],
    availabilityRuleIds: [],
  })
  const item = await publishItem(db, admin, draft.id, { version: draft.version })
  bread = { id: item.id, variationId: item.variations[0]!.id }
})

const input = (over: Partial<PlaceOrderInput> = {}): PlaceOrderInput => ({
  branchId,
  tableToken: null,
  lines: [{ itemId: bread.id, variationId: bread.variationId, modifierIds: [], quantity: 1, note: null }],
  expectedTotalMinor: 250,
  ...over,
})
const place = (actor: Actor, over: Partial<PlaceOrderInput> = {}) => placeOrder(db, actor, input(over), crypto.randomUUID(), NOON)

/** A guest as Better Auth's anonymous sign-in makes one: a session, `isAnonymous`, named "Guest". */
async function signInAsGuest() {
  const { headers } = await auth.api.signInAnonymous({ returnHeaders: true })
  const session = sessionHeaders(headers)
  const sessionUser = (await auth.api.getSession({ headers: session }))!.user as SessionUser
  return { headers: session, sessionUser, actor: await authorizeCustomer(db, sessionUser, TEST_TENANT) }
}

const nameOf = async (userId: string) => (await db.select({ name: user.name }).from(user).where(eq(user.id, userId)))[0]!.name

describe('a guest (D156)', () => {
  it('is signed in as a guest with no profile or member code, and acts as a customer', async () => {
    const guest = await signInAsGuest()
    expect(guest.sessionUser).toMatchObject({ isAnonymous: true, name: 'Guest', emailVerified: false })
    expect(guest.actor).toMatchObject({ role: 'customer', guest: true })
    expect(await db.select().from(customerProfiles).where(eq(customerProfiles.userId, guest.sessionUser.id))).toEqual([])
  })

  it('orders with their name, which the counter shows; the order is theirs alone', async () => {
    const guest = await signInAsGuest()
    const { orderId } = await place(guest.actor, { guestName: '  Srey Neang ' })
    expect(await nameOf(guest.actor.userId)).toBe('Srey Neang')
    expect((await getOrder(db, guest.actor, orderId)).status).toBe('awaiting_payment')

    const queue = await listCounterQueue(db, { ...admin, branchId }, NOON)
    expect(queue.orders.map(order => order.customer.name)).toEqual(['Srey Neang'])

    const other: Actor = { userId: (await createUser(db)).id, tenantId: TEST_TENANT, role: 'customer' }
    await expectApiError(() => getOrder(db, other, orderId), 404, 'NOT_FOUND')
  })

  it('must give a name; nothing is stored without one', async () => {
    const guest = await signInAsGuest()
    await expectApiError(() => place(guest.actor), 400, 'VALIDATION_FAILED')
    expect(await db.select().from(orders)).toEqual([])
  })

  it('a name sent by an account never renames it (only a guest is named by an order)', async () => {
    const account: Actor = { userId: (await createUser(db, 'dara@example.com', 'Dara')).id, tenantId: TEST_TENANT, role: 'customer' }
    await place(account, { guestName: 'Someone Else' })
    expect(await nameOf(account.userId)).toBe('Dara')
  })

  it('the rename itself only touches a guest, whoever asks (the database guard behind the service)', async () => {
    const account = await createUser(db, 'dara@example.com', 'Dara')
    await db.batch([guestNameStatement(db, account.id, 'Someone Else', NOON)])
    expect(await nameOf(account.id)).toBe('Dara')
  })

  it('has the same limit as an account: two unpaid orders', async () => {
    const guest = await signInAsGuest()
    await place(guest.actor, { guestName: 'Srey' })
    await place(guest.actor, { guestName: 'Srey' })
    await expectApiError(() => place(guest.actor, { guestName: 'Srey' }), 409, 'TOO_MANY_UNPAID_ORDERS')
  })

  it('signing up on the same device moves their orders to the new account', async () => {
    const guest = await signInAsGuest()
    const { orderId } = await place(guest.actor, { guestName: 'Srey' })

    const { response } = await auth.api.signUpEmail({ body: { email: 'srey@example.com', password: 'the customer password', name: 'Srey Neang' }, headers: guest.headers, returnHeaders: true })
    const account = await authorizeSignedIn(db, response.user as SessionUser, TEST_TENANT)

    expect((await getOrder(db, account, orderId)).id).toBe(orderId)
    expect((await listMyOrders(db, guest.actor, { page: 1, pageSize: 20 })).inProgress).toEqual([])
    // The guest stays (its orders were the reason it can't be deleted), with nothing.
    expect(await nameOf(guest.actor.userId)).toBe('Srey')
  })

  it('moves orders in every cafe, and nobody else\'s', async () => {
    const guest = await createUser(db)
    const someone = await createUser(db)
    const account = await createUser(db)
    const guestActor: Actor = { userId: guest.id, tenantId: TEST_TENANT, role: 'customer' }
    const someoneActor: Actor = { userId: someone.id, tenantId: TEST_TENANT, role: 'customer' }
    await place(guestActor)
    await place(someoneActor)

    await moveGuestOrders(db, guest.id, account.id)
    const owners = (await db.select({ customerId: orders.customerId }).from(orders)).map(row => row.customerId).sort()
    expect(owners).toEqual([account.id, someone.id].sort())
  })
})
