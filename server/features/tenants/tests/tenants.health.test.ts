import { beforeEach, describe, expect, it } from 'vitest'
import { SCHEDULED_JOBS } from '#shared/scheduled-tasks'
import type { Db } from '#server/utils/batch'
import { user } from '#server/db/tables'
import { createTestDb, ensureTenant, TEST_TENANT } from '#server/tests/support/db'
import { bakongTokens } from '#server/features/orders/orders.schema'
import { notificationDeliveries, telegramDestinations } from '#server/features/notifications/notifications.schema'
import { outboxMessages } from '#server/features/platform/platform.schema'
import { recordJobRun } from '#server/features/platform'
import { getPlatformHealth } from '#server/features/tenants'

// The platform console's System health (step P4, D192), against SQLite built from the migrations:
// counts and dates per kind and cafe, every scheduled job, and never a secret in the answer.

let db: Db
const OTHER = 'tenant-2'
const NOW = new Date('2026-10-19T05:00:00Z')
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000)
const days = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000)
/** Strings that must never leave the server: a payload, an error's text, a message, a chat, a sealed token. */
const SECRETS = ['SECRET-PAYLOAD', 'SECRET-ERROR', 'SECRET-MESSAGE', 'SECRET-CHAT', 'SECRET-SEALED', 'SECRET-TITLE']

beforeEach(async () => {
  db = await createTestDb()
  await ensureTenant(db, TEST_TENANT, 'nuk')
  await ensureTenant(db, OTHER, 'brown-bean')
  await db.insert(user).values({ id: 'owner-1', email: 'owner@example.com', name: 'Owner' })
})

describe('system health', () => {
  it('counts unsent outbox messages per kind and cafe: waiting, failing, dead; never what they carry', async () => {
    await db.insert(outboxMessages).values([
      { tenantId: TEST_TENANT, kind: 'orders.event', payload: { note: 'SECRET-PAYLOAD' }, createdAt: minutes(-30) },
      { tenantId: TEST_TENANT, kind: 'orders.event', payload: { note: 'SECRET-PAYLOAD' }, attempts: 3, lastError: 'SECRET-ERROR', createdAt: minutes(-10) },
      { tenantId: OTHER, kind: 'orders.event', payload: {}, status: 'failed', attempts: 8, lastError: 'SECRET-ERROR', createdAt: minutes(-90) },
      { tenantId: null, kind: 'identity.reset-password', payload: { url: 'SECRET-PAYLOAD' }, status: 'failed', attempts: 8, lastError: 'SECRET-ERROR' },
      // Sent: not unsent work.
      { tenantId: TEST_TENANT, kind: 'orders.event', payload: {}, status: 'sent', sentAt: NOW },
    ])
    const health = await getPlatformHealth(db, NOW)
    expect(health.outbox).toMatchObject({ waiting: 1, failing: 1, dead: 2 })
    expect(health.outbox.groups).toEqual(expect.arrayContaining([
      { kind: 'orders.event', cafe: { id: TEST_TENANT, name: `Cafe ${TEST_TENANT}`, slug: 'nuk' }, waiting: 1, failing: 1, dead: 0, oldestAt: minutes(-30).toISOString() },
      { kind: 'orders.event', cafe: { id: OTHER, name: `Cafe ${OTHER}`, slug: 'brown-bean' }, waiting: 0, failing: 0, dead: 1, oldestAt: minutes(-90).toISOString() },
      expect.objectContaining({ kind: 'identity.reset-password', cafe: null, dead: 1 }),
    ]))
    expect(health.outbox.groups).toHaveLength(3)
    for (const secret of SECRETS) expect(JSON.stringify(health)).not.toContain(secret)
  })

  it('lists every scheduled job, one that never ran too, with its last run and failures in a row', async () => {
    const before = await getPlatformHealth(db, NOW)
    expect(before.jobs.map(job => job.job)).toEqual(SCHEDULED_JOBS.map(job => job.job))
    expect(before.jobs.every(job => job.state === 'never' && job.lastRunAt === null)).toBe(true)

    await recordJobRun(db, 'platform:deliver-outbox', 'success', minutes(0))
    await recordJobRun(db, 'orders:expire-unpaid', 'failure', minutes(0))
    await recordJobRun(db, 'orders:expire-unpaid', 'failure', minutes(1))
    const jobs = new Map((await getPlatformHealth(db, NOW)).jobs.map(job => [job.job, job]))
    expect(jobs.get('platform:deliver-outbox')).toMatchObject({ schedule: '* * * * *', state: 'ok', lastSuccessAt: minutes(0).toISOString(), failuresInARow: 0 })
    expect(jobs.get('orders:expire-unpaid')).toMatchObject({ state: 'failing', lastFailureAt: minutes(1).toISOString(), lastSuccessAt: null, failuresInARow: 2 })
  })

  it('writes a success at most every 5 minutes while nothing failed, and always after a failure', async () => {
    const job = 'platform:deliver-outbox'
    const last = async () => (await getPlatformHealth(db, NOW)).jobs.find(entry => entry.job === job)!
    await recordJobRun(db, job, 'success', minutes(0))
    await recordJobRun(db, job, 'success', minutes(1))
    expect((await last()).lastSuccessAt).toBe(minutes(0).toISOString())
    await recordJobRun(db, job, 'success', minutes(5))
    expect((await last()).lastSuccessAt).toBe(minutes(5).toISOString())
    await recordJobRun(db, job, 'failure', minutes(6))
    await recordJobRun(db, job, 'success', minutes(7))
    expect(await last()).toMatchObject({ state: 'ok', lastSuccessAt: minutes(7).toISOString(), lastFailureAt: minutes(6).toISOString(), failuresInARow: 0 })
  })

  it('counts failing Telegram deliveries of the last 7 days per cafe, never their message or chat', async () => {
    for (const tenantId of [TEST_TENANT, OTHER]) {
      await db.insert(telegramDestinations).values({ id: `dest-${tenantId}`, tenantId, chatId: 'SECRET-CHAT', kind: 'group', title: 'SECRET-TITLE' })
    }
    const delivery = (id: string, tenantId: string, values: Record<string, unknown>) => ({
      id, tenantId, destinationId: `dest-${tenantId}`, kind: 'new_order' as const, dedupeKey: id, subject: 'SECRET-MESSAGE', message: { html: 'SECRET-MESSAGE' }, lastError: 'SECRET-ERROR', ...values,
    })
    await db.insert(notificationDeliveries).values([
      delivery('d-1', TEST_TENANT, { status: 'failed', attempts: 5, createdAt: days(-1) }),
      delivery('d-2', TEST_TENANT, { status: 'failed', attempts: 5, createdAt: days(-2) }),
      delivery('d-3', TEST_TENANT, { status: 'pending', attempts: 2, createdAt: minutes(-5) }),
      // Older than 7 days, sent, and pending without a try: not failing now.
      delivery('d-4', TEST_TENANT, { status: 'failed', attempts: 5, createdAt: days(-8) }),
      delivery('d-5', OTHER, { status: 'sent', attempts: 1, createdAt: days(-1) }),
      delivery('d-6', OTHER, { status: 'pending', attempts: 0, createdAt: minutes(-1) }),
    ])
    const health = await getPlatformHealth(db, NOW)
    expect(health.telegram).toEqual([{ cafe: { id: TEST_TENANT, name: `Cafe ${TEST_TENANT}`, slug: 'nuk' }, failed: 2, retrying: 1, newestFailingAt: minutes(-5).toISOString() }])
    for (const secret of SECRETS) expect(JSON.stringify(health)).not.toContain(secret)
  })

  it('gives each saved Bakong token\'s expiry and state, soonest first, never the token', async () => {
    await ensureTenant(db, 'tenant-3', 'tea-kiosk')
    await ensureTenant(db, 'tenant-4', 'old-mill')
    const token = (tenantId: string, expiresAt: Date | null) => ({ tenantId, sealed: 'v1.SECRET-SEALED', expiresAt, updatedBy: 'owner-1', updatedAt: NOW })
    await db.insert(bakongTokens).values([token(TEST_TENANT, days(30)), token(OTHER, days(3)), token('tenant-3', days(-1)), token('tenant-4', null)])
    const health = await getPlatformHealth(db, NOW)
    expect(health.bakong.map(row => [row.cafe.slug, row.state])).toEqual([['tea-kiosk', 'expired'], ['brown-bean', 'soon'], ['nuk', 'ok'], ['old-mill', 'unknown']])
    expect(health.bakong[1]!.expiresAt).toBe(days(3).toISOString())
    for (const secret of SECRETS) expect(JSON.stringify(health)).not.toContain(secret)
  })
})
