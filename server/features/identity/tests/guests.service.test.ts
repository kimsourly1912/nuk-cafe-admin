import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { account, session, user } from '#server/db/tables'
import { clearIdleGuests } from '#server/features/identity/guests.service'
import { orders } from '#server/features/orders/orders.schema'
import { customersOrderingSince } from '#server/features/orders/orders.service'
import { createTestAuth, sessionHeaders } from '#server/tests/support/auth'
import { createTestDb, createUser, ensureTenant, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import type { Db } from '#server/utils/batch'
import { newId } from '#server/utils/ids'

// The daily cleanup of guests (D229, D236): a guest unused for 90 days is emptied (its name, sessions
// and sign-in gone), never deleted: its orders, in every cafe, stay and read "Guest".

const NOW = new Date('2027-03-01T03:15:00Z')
const DAY = 24 * 60 * 60 * 1000
const ago = (days: number, minutes = 0) => new Date(NOW.getTime() - days * DAY - minutes * 60_000)
const OTHER = 'tenant-2'

let db: Db
let pickup = 0

beforeEach(async () => {
  db = await createTestDb()
  await ensureTenant(db)
  await ensureTenant(db, OTHER)
  await insertBranch(db, { id: 'ours', name: 'Riverside', timezone: 'Asia/Phnom_Penh' })
  await insertBranch(db, { id: 'theirs', name: 'Brown Bean', timezone: 'Asia/Phnom_Penh', tenantId: OTHER })
})

const run = (options: { pageSize?: number } = {}) =>
  clearIdleGuests(db, { now: NOW, orderedSince: (ids, since) => customersOrderingSince(db, ids, since), ...options })

/** A guest named `name`, made and last changed `days` ago, with a session last used then too. */
async function guest(name: string, days: number, extra: { sessionDays?: number | null } = {}) {
  const id = newId()
  const at = ago(days)
  await db.insert(user).values({ id, name, email: `temp-${id}@anonymous.invalid`, isAnonymous: true, createdAt: at, updatedAt: at })
  const sessionDays = extra.sessionDays === undefined ? days : extra.sessionDays
  if (sessionDays !== null) {
    const used = ago(sessionDays)
    await db.insert(session).values({ id: newId(), userId: id, token: newId(), expiresAt: new Date(used.getTime() + 7 * DAY), createdAt: used, updatedAt: used, ipAddress: '203.0.113.9', userAgent: 'Phone' })
  }
  return id
}

async function order(customerId: string, days: number, tenantId = TEST_TENANT) {
  const id = newId()
  const at = ago(days)
  await db.insert(orders).values({ id, tenantId, branchId: tenantId === TEST_TENANT ? 'ours' : 'theirs', customerId, businessDate: '2026-11-01', pickupNumber: ++pickup, orderType: 'pickup', subtotalMinor: 350, totalMinor: 350, placedAt: at, paymentDueAt: at, status: 'completed' })
  return id
}

const userRow = async (id: string) => (await db.select().from(user).where(eq(user.id, id)))[0]!
const sessionsOf = async (id: string) => (await db.select().from(session).where(eq(session.userId, id))).length

describe('emptying idle guests', () => {
  it('empties a guest unused for 90 days: "Guest", its sessions gone, its orders in both cafes kept', async () => {
    const dara = await guest('Dara', 120)
    const ours = await order(dara, 100)
    const theirs = await order(dara, 95, OTHER)

    expect(await run()).toEqual({ emptied: 1, kept: 0 })
    expect(await userRow(dara)).toMatchObject({ name: 'Guest', isAnonymous: true, anonymizedAt: NOW, updatedAt: NOW })
    expect(await sessionsOf(dara)).toBe(0)
    const kept = await db.select({ id: orders.id, customerId: orders.customerId }).from(orders)
    expect(kept.sort((a, b) => a.id.localeCompare(b.id))).toEqual([{ id: ours, customerId: dara }, { id: theirs, customerId: dara }].sort((a, b) => a.id.localeCompare(b.id)))
  })

  it('keeps a guest used within 90 days: a recent change, a recent session, or a recent order in either cafe', async () => {
    const renamed = await guest('Renamed', 89, { sessionDays: 120 })
    const browsing = await guest('Browsing', 120, { sessionDays: 10 })
    const ordered = await guest('Ordered', 120, { sessionDays: null })
    await order(ordered, 30)
    const orderedThere = await guest('Ordered there', 120, { sessionDays: null })
    await order(orderedThere, 60, OTHER)
    const idle = await guest('Idle', 120)

    expect(await run()).toEqual({ emptied: 1, kept: 2 })
    expect((await userRow(idle)).name).toBe('Guest')
    for (const [id, name] of [[renamed, 'Renamed'], [browsing, 'Browsing'], [ordered, 'Ordered'], [orderedThere, 'Ordered there']] as const) {
      expect(await userRow(id)).toMatchObject({ name, anonymizedAt: null })
    }
    expect(await sessionsOf(browsing)).toBe(1)
  })

  it('counts 90 days exactly: one minute short is kept, one minute past is emptied', async () => {
    const short = await guest('Short', 89, { sessionDays: 120 })
    await db.update(user).set({ createdAt: ago(120), updatedAt: ago(89, 24 * 60 - 1) }).where(eq(user.id, short))
    const past = await guest('Past', 90, { sessionDays: 120 })
    await db.update(user).set({ createdAt: ago(120), updatedAt: ago(90, 1) }).where(eq(user.id, past))
    expect(await run()).toEqual({ emptied: 1, kept: 0 })
    expect((await userRow(short)).name).toBe('Short')
    expect((await userRow(past)).name).toBe('Guest')
  })

  it('never touches a registered account, however long unused, nor its sessions', async () => {
    const registered = await createUser(db, 'kim@example.com', 'Kim')
    await db.update(user).set({ createdAt: ago(400), updatedAt: ago(400) }).where(eq(user.id, registered.id))
    // A row from before guests existed: `is_anonymous` null is an account too (`registeredAccount`).
    const legacy = await createUser(db, 'old@example.com', 'Old')
    await db.update(user).set({ isAnonymous: null, createdAt: ago(400), updatedAt: ago(400) }).where(eq(user.id, legacy.id))
    await db.insert(session).values({ id: newId(), userId: registered.id, token: newId(), expiresAt: ago(393), createdAt: ago(400), updatedAt: ago(400) })

    expect(await run()).toEqual({ emptied: 0, kept: 0 })
    expect((await userRow(registered.id)).name).toBe('Kim')
    expect((await userRow(legacy.id)).name).toBe('Old')
    expect(await sessionsOf(registered.id)).toBe(1)
  })

  it('is safe to run twice: an emptied guest is left as it is, also once idle again', async () => {
    const dara = await guest('Dara', 120)
    await run()
    expect(await run()).toEqual({ emptied: 0, kept: 0 })
    // 100 days on, the shell is idle again but stays as it was, with the day it was emptied.
    const later = new Date(NOW.getTime() + 100 * DAY)
    expect(await clearIdleGuests(db, { now: later, orderedSince: (ids, since) => customersOrderingSince(db, ids, since) })).toEqual({ emptied: 0, kept: 0 })
    expect(await userRow(dara)).toMatchObject({ anonymizedAt: NOW, updatedAt: NOW })
  })

  it('pages past guests kept for a recent order, so they never hold up the rest', async () => {
    for (let i = 0; i < 5; i++) await order(await guest(`Kept ${i}`, 200 - i, { sessionDays: null }), 10)
    const idle = [await guest('Idle 1', 150), await guest('Idle 2', 140)]
    expect(await run({ pageSize: 2 })).toEqual({ emptied: 2, kept: 5 })
    for (const id of idle) expect((await userRow(id)).name).toBe('Guest')
  })

  it('leaves a guest used between the read and the write (the write checks again)', async () => {
    const dara = await guest('Dara', 120)
    const result = await clearIdleGuests(db, {
      now: NOW,
      orderedSince: async (ids, since) => {
        // Dara comes back while the cleanup asks about orders.
        await db.update(session).set({ updatedAt: ago(0) }).where(eq(session.userId, dara))
        return customersOrderingSince(db, ids, since)
      },
    })
    expect(result).toEqual({ emptied: 0, kept: 0 })
    expect(await userRow(dara)).toMatchObject({ name: 'Dara', anonymizedAt: null })
    expect(await sessionsOf(dara)).toBe(1)
  })

  it('removes any sign-in the guest had', async () => {
    const dara = await guest('Dara', 120)
    await db.insert(account).values({ id: newId(), accountId: dara, providerId: 'credential', userId: dara, createdAt: ago(120), updatedAt: ago(120) })
    await run()
    expect((await db.select().from(account).where(eq(account.userId, dara))).length).toBe(0)
  })
})

describe('through Better Auth', () => {
  it('a real guest\'s browser is signed out for good once it is emptied', async () => {
    const auth = createTestAuth(db)
    const { headers } = await auth.api.signInAnonymous({ returnHeaders: true })
    const cookie = sessionHeaders(headers)
    const signedIn = (await auth.api.getSession({ headers: cookie }))!
    // 120 days later, with the cookie kept (sessions last 7 days, so it would have lapsed anyway).
    await db.update(user).set({ name: 'Dara', createdAt: ago(120), updatedAt: ago(120) }).where(eq(user.id, signedIn.user.id))
    await db.update(session).set({ createdAt: ago(120), updatedAt: ago(120), expiresAt: new Date(Date.now() + DAY) }).where(eq(session.userId, signedIn.user.id))

    expect(await run()).toEqual({ emptied: 1, kept: 0 })
    expect(await auth.api.getSession({ headers: cookie })).toBeNull()
    expect((await userRow(signedIn.user.id)).name).toBe('Guest')
  })
})
