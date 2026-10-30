import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { DeleteAccountInput } from '#shared/contracts/account'
import { account, branchStaff, member, session, twoFactor, user, verification } from '#server/db/tables'
import { customerProfiles } from '#server/features/customers/customers.schema'
import { ensureProfile } from '#server/features/customers/customers.service'
import { deleteAccount } from '#server/features/identity/erasure.service'
import type { DeleteAccountOptions } from '#server/features/identity/erasure.service'
import { MAIL_KINDS } from '#server/features/identity/identity.mail'
import type { SessionUser } from '#server/features/identity/identity.types'
import { orders } from '#server/features/orders/orders.schema'
import { hasOrderInProgress, requireNoOrderInProgress } from '#server/features/orders/orders.service'
import { auditEvents, outboxMessages } from '#server/features/platform/platform.schema'
import { createTestAuth, sessionHeaders, signIn } from '#server/tests/support/auth'
import type { TestAuth } from '#server/tests/support/auth'
import { createTestDb, ensureTenant, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import type { Db } from '#server/utils/batch'
import { newId } from '#server/utils/ids'

// An account deletes itself (D229, D237): emptied, never removed, so the cafes keep its orders
// without its name. Against Better Auth's real sign-up, password check and sessions.

const OTHER = 'tenant-2'
const PASSWORD = 'long-enough-password-1'
const NOW = new Date('2026-11-02T03:00:00Z')

let db: Db
let auth: TestAuth
let pickup = 0

beforeEach(async () => {
  db = await createTestDb()
  await ensureTenant(db)
  await ensureTenant(db, OTHER)
  auth = createTestAuth(db)
  await insertBranch(db, { id: 'ours', name: 'Riverside', timezone: 'Asia/Phnom_Penh' })
  await insertBranch(db, { id: 'theirs', name: 'Brown Bean', timezone: 'Asia/Phnom_Penh', tenantId: OTHER })
})

/** A customer who signed up with `email`, signed in; `verified` marks the address confirmed. */
async function customer(email: string, verified = true) {
  await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: 'Sophal' } })
  if (verified) await db.update(user).set({ emailVerified: true }).where(eq(user.email, email))
  const headers = await signIn(auth, email, PASSWORD)
  const sessionUser = (await auth.api.getSession({ headers }))!.user as SessionUser
  return { id: sessionUser.id, headers, sessionUser }
}

type Customer = Awaited<ReturnType<typeof customer>>

async function order(customerId: string, status: 'completed' | 'preparing' | 'awaiting_payment' | 'ready' | 'cancelled' = 'completed', tenantId = TEST_TENANT) {
  const id = newId()
  await db.insert(orders).values({ id, tenantId, branchId: tenantId === TEST_TENANT ? 'ours' : 'theirs', customerId, businessDate: '2026-11-01', pickupNumber: ++pickup, orderType: 'pickup', subtotalMinor: 350, totalMinor: 350, placedAt: NOW, paymentDueAt: NOW, status })
  return id
}

function options(person: Customer, over: Partial<DeleteAccountOptions> = {}): DeleteAccountOptions {
  return {
    verifyPassword: password => auth.api.verifyPassword({ headers: person.headers, body: { password } }).then(() => true, () => false),
    hasOrderInProgress: () => hasOrderInProgress(db, person.id),
    noOrderInProgress: requireNoOrderInProgress(db, person.id),
    requestId: 'req-1',
    now: NOW,
    ...over,
  }
}

const remove = (person: Customer, input: DeleteAccountInput = { password: PASSWORD }, over: Partial<DeleteAccountOptions> = {}) =>
  deleteAccount(db, person.sessionUser, input, options(person, over))

const userRow = async (id: string) => (await db.select().from(user).where(eq(user.id, id)))[0]!
const countOf = async (table: typeof session | typeof account | typeof twoFactor, id: string) =>
  (await db.select().from(table).where(eq(table.userId, id))).length
const mails = () => db.select({ kind: outboxMessages.kind, payload: outboxMessages.payload }).from(outboxMessages).where(eq(outboxMessages.kind, MAIL_KINDS.accountDeleted))

/** Nothing about the person changed: name, email, sessions, password. */
async function untouched(person: Customer, email: string) {
  expect(await userRow(person.id)).toMatchObject({ name: 'Sophal', email, anonymizedAt: null })
  expect(await countOf(session, person.id)).toBeGreaterThan(0)
  expect(await countOf(account, person.id)).toBe(1)
  expect(await mails()).toEqual([])
}

describe('deleting an account', () => {
  it('empties it in every cafe: who it was replaced, signed out, profiles anonymised, orders kept, one email, an audit entry', async () => {
    const sophal = await customer('sophal@example.com')
    const other = await customer('other@example.com')
    for (const [tenant, who] of [[TEST_TENANT, sophal.id], [OTHER, sophal.id], [TEST_TENANT, other.id]] as const) {
      await ensureProfile(db, tenant, who)
      await db.update(customerProfiles).set({ phone: '012 345 678', marketingOptIn: true }).where(eq(customerProfiles.userId, who))
    }
    const ours = await order(sophal.id)
    const theirs = await order(sophal.id, 'cancelled', OTHER)
    await db.insert(twoFactor).values({ id: newId(), userId: sophal.id, secret: 's', backupCodes: 'b' })
    await auth.api.requestPasswordReset({ body: { email: 'sophal@example.com' } })
    expect((await db.select().from(verification).where(eq(verification.value, sophal.id))).length).toBe(1)

    await remove(sophal)

    expect(await userRow(sophal.id)).toMatchObject({ name: 'Deleted account', email: `deleted-${sophal.id}@anonymous.invalid`, emailVerified: false, image: null, anonymizedAt: NOW })
    for (const table of [session, account, twoFactor] as const) expect(await countOf(table, sophal.id)).toBe(0)
    expect((await db.select().from(verification).where(eq(verification.value, sophal.id))).length).toBe(0)
    const profiles = await db.select().from(customerProfiles).where(eq(customerProfiles.userId, sophal.id))
    expect(profiles.map(p => ({ tenantId: p.tenantId, phone: p.phone, marketingOptIn: p.marketingOptIn, anonymizedAt: p.anonymizedAt })).sort((a, b) => a.tenantId.localeCompare(b.tenantId)))
      .toEqual([TEST_TENANT, OTHER].sort().map(tenantId => ({ tenantId, phone: null, marketingOptIn: false, anonymizedAt: NOW })))
    // Orders stay with each cafe, pointing at the emptied account.
    expect((await db.select({ id: orders.id }).from(orders).where(eq(orders.customerId, sophal.id))).map(o => o.id).sort()).toEqual([ours, theirs].sort())
    expect(await mails()).toEqual([{ kind: MAIL_KINDS.accountDeleted, payload: { to: 'sophal@example.com' } }])
    const [audit] = await db.select().from(auditEvents).where(eq(auditEvents.action, 'identity.account.delete'))
    expect(audit).toMatchObject({ actorId: sophal.id, tenantId: null, targetType: 'user', targetId: sophal.id, requestId: 'req-1' })
    expect(JSON.stringify(audit)).not.toContain('sophal@example.com')

    // The other customer keeps everything.
    expect(await userRow(other.id)).toMatchObject({ name: 'Sophal', email: 'other@example.com', anonymizedAt: null })
    expect((await db.select().from(customerProfiles).where(eq(customerProfiles.userId, other.id)))[0]).toMatchObject({ phone: '012 345 678', marketingOptIn: true })
  })

  it('signs the browser out for good, and the email is free for a new account', async () => {
    const sophal = await customer('sophal@example.com')
    await remove(sophal)
    expect(await auth.api.getSession({ headers: sophal.headers })).toBeNull()
    await expect(signIn(auth, 'sophal@example.com', PASSWORD)).rejects.toThrow()
    const again = await auth.api.signUpEmail({ body: { email: 'sophal@example.com', password: PASSWORD, name: 'Sophal' }, returnHeaders: true })
    expect(again.response.user.id).not.toBe(sophal.id)
    expect(await auth.api.getSession({ headers: sessionHeaders(again.headers) })).not.toBeNull()
  })

  it('sends no email to an address never verified (a bot\'s fake one costs nothing)', async () => {
    const sophal = await customer('sophal@example.com', false)
    await remove(sophal)
    expect((await userRow(sophal.id)).name).toBe('Deleted account')
    expect(await mails()).toEqual([])
  })

  it('refuses a wrong password, writing nothing', async () => {
    const sophal = await customer('sophal@example.com')
    await expectApiError(() => remove(sophal, { password: 'not-the-password-at-all' }), 400, 'WRONG_PASSWORD')
    await untouched(sophal, 'sophal@example.com')
  })

  it('refuses someone not signed in, and a guest', async () => {
    const sophal = await customer('sophal@example.com')
    await expectApiError(() => deleteAccount(db, null, { password: PASSWORD }, options(sophal)), 401, 'UNAUTHENTICATED')
    const { headers } = await auth.api.signInAnonymous({ returnHeaders: true })
    const guest = (await auth.api.getSession({ headers: sessionHeaders(headers) }))!.user as SessionUser
    await expectApiError(() => deleteAccount(db, guest, { password: PASSWORD }, options(sophal)), 403, 'FORBIDDEN')
    expect((await userRow(guest.id)).anonymizedAt).toBeNull()
    await untouched(sophal, 'sophal@example.com')
  })

  it('refuses an account that works at a cafe (a member, or staff at a branch) or runs the platform', async () => {
    const owner = await customer('owner@example.com')
    await db.insert(member).values({ id: newId(), organizationId: OTHER, userId: owner.id, role: 'owner', createdAt: NOW })
    await expectApiError(() => remove(owner), 409, 'ACCOUNT_HAS_ACCESS')
    await untouched(owner, 'owner@example.com')

    const barista = await customer('barista@example.com')
    await db.insert(branchStaff).values({ tenantId: TEST_TENANT, branchId: 'ours', userId: barista.id, role: 'staff', createdAt: NOW })
    await expectApiError(() => remove(barista), 409, 'ACCOUNT_HAS_ACCESS')
    await untouched(barista, 'barista@example.com')

    const ops = await customer('ops@example.com')
    await db.update(user).set({ role: 'customer, superadmin' }).where(eq(user.id, ops.id))
    await expectApiError(() => remove(ops), 409, 'ACCOUNT_HAS_ACCESS')
    await untouched(ops, 'ops@example.com')
  })

  it('waits for an order in progress in either cafe; finished ones don\'t count', async () => {
    const sophal = await customer('sophal@example.com')
    await order(sophal.id, 'completed')
    await order(sophal.id, 'cancelled')
    const making = await order(sophal.id, 'preparing', OTHER)
    await expectApiError(() => remove(sophal), 409, 'ORDER_IN_PROGRESS')
    await untouched(sophal, 'sophal@example.com')
    await db.update(orders).set({ status: 'completed' }).where(eq(orders.id, making))
    await remove(sophal)
    expect((await userRow(sophal.id)).name).toBe('Deleted account')
  })

  it('writes nothing when access is given while it is being deleted (the write checks again)', async () => {
    const sophal = await customer('sophal@example.com')
    const grantedMeanwhile = async () => {
      await db.insert(member).values({ id: newId(), organizationId: TEST_TENANT, userId: sophal.id, role: 'owner', createdAt: NOW })
      return false
    }
    await expectApiError(() => remove(sophal, undefined, { hasOrderInProgress: grantedMeanwhile }), 409, 'VERSION_CONFLICT')
    await untouched(sophal, 'sophal@example.com')
  })

  it('writes nothing when an order is placed while it is being deleted', async () => {
    const sophal = await customer('sophal@example.com')
    const orderedMeanwhile = async () => {
      await order(sophal.id, 'awaiting_payment')
      return false
    }
    await expectApiError(() => remove(sophal, undefined, { hasOrderInProgress: orderedMeanwhile }), 409, 'VERSION_CONFLICT')
    await untouched(sophal, 'sophal@example.com')
  })

  it('writes nothing when the email changes, or the platform role is given, while it is being deleted', async () => {
    const sophal = await customer('sophal@example.com')
    const emailChanged = async () => {
      await db.update(user).set({ email: 'new@example.com' }).where(eq(user.id, sophal.id))
      return false
    }
    await expectApiError(() => remove(sophal, undefined, { hasOrderInProgress: emailChanged }), 409, 'VERSION_CONFLICT')
    await untouched(sophal, 'new@example.com')

    const ops = await customer('ops@example.com')
    const promoted = async () => {
      await db.update(user).set({ role: 'superadmin' }).where(eq(user.id, ops.id))
      return false
    }
    await expectApiError(() => remove(ops, undefined, { hasOrderInProgress: promoted }), 409, 'VERSION_CONFLICT')
    await untouched(ops, 'ops@example.com')
  })

  it('two requests at once (a double tap): one deletes, the other writes nothing', async () => {
    const sophal = await customer('sophal@example.com')
    const second = async () => {
      // The first request is between its checks and its write when the second one finishes.
      await remove(sophal)
      return false
    }
    await expectApiError(() => remove(sophal, undefined, { hasOrderInProgress: second }), 409, 'VERSION_CONFLICT')
    expect(await mails()).toHaveLength(1)
    expect((await db.select().from(auditEvents).where(eq(auditEvents.action, 'identity.account.delete')))).toHaveLength(1)
  })

  it('happens once: a second request with the old session is refused', async () => {
    const sophal = await customer('sophal@example.com')
    await remove(sophal)
    await expectApiError(() => remove(sophal, undefined, { verifyPassword: async () => true }), 401, 'UNAUTHENTICATED')
    expect(await mails()).toHaveLength(1)
    expect((await userRow(sophal.id)).anonymizedAt).toEqual(NOW)
  })
})
