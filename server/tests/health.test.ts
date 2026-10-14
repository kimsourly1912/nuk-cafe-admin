import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { operationalHealth } from '#server/utils/health'
import { outboxStatement, saveJobCursor } from '#server/features/platform'
import { outboxMessages } from '#server/features/platform/platform.schema'
import { notificationDeliveries, telegramDestinations } from '#server/features/notifications/notifications.schema'
import { createAdmin, createTestDb, ensureTenant, TEST_TENANT } from '#server/tests/support/db'

const disabled = { notificationMaxAgeSeconds: 0, deliveryMaxAgeSeconds: 0 }

it('keeps checks opt-in and requires successful generation when enabled', async () => {
  const db = await createTestDb()
  expect(await operationalHealth(db, disabled)).toBe(true)
  const settings = { ...disabled, notificationMaxAgeSeconds: 300 }
  const now = new Date()
  for (const invalid of [NaN, Infinity, -1]) expect(await operationalHealth(db, { ...disabled, deliveryMaxAgeSeconds: invalid }, now)).toBe(false)
  expect(await operationalHealth(db, settings, now)).toBe(false)
  await saveJobCursor(db, 'notifications:generate', null, { now, processed: 2, failures: 2 })
  expect(await operationalHealth(db, settings, now)).toBe(false)
  await saveJobCursor(db, 'notifications:generate', null, { now, processed: 2, failures: 1 })
  expect(await operationalHealth(db, settings, now)).toBe(true)
  expect(await operationalHealth(db, settings, new Date(now.getTime() + 301_000))).toBe(false)
})

it('detects overdue outbox work across cafes without treating future retries or history as overdue', async () => {
  const db = await createTestDb()
  for (const id of [TEST_TENANT, 'other']) await ensureTenant(db, id)
  const now = new Date()
  for (const tenantId of [TEST_TENANT, 'other']) await db.batch([outboxStatement(db, tenantId, 'audit.test', {})])
  await db.update(outboxMessages).set({ nextAttemptAt: new Date(now.getTime() + 10_000) })
  const [row] = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, 'other'))
  await db.update(outboxMessages).set({ nextAttemptAt: new Date(now.getTime() - 301_000) }).where(eq(outboxMessages.id, row!.id))
  const settings = { ...disabled, deliveryMaxAgeSeconds: 300 }
  expect(await operationalHealth(db, disabled, now)).toBe(true)
  expect(await operationalHealth(db, settings, now)).toBe(false)
  await db.update(outboxMessages).set({ status: 'sent' }).where(eq(outboxMessages.id, row!.id))
  expect(await operationalHealth(db, settings, now)).toBe(true)
})

it('detects an overdue notification even when the outbox is empty', async () => {
  const db = await createTestDb()
  const owner = await createAdmin(db)
  const now = new Date()
  await db.insert(telegramDestinations).values({ id: 'destination', tenantId: TEST_TENANT, chatId: '1', kind: 'private', title: 'Operations', connectedBy: owner.userId })
  await db.insert(notificationDeliveries).values({ id: 'delivery', tenantId: TEST_TENANT, kind: 'server_error', destinationId: 'destination', dedupeKey: 'probe', subject: 'Probe', message: { html: 'Probe' }, nextAttemptAt: new Date(now.getTime() - 301_000) })
  const settings = { ...disabled, deliveryMaxAgeSeconds: 300 }
  expect(await operationalHealth(db, settings, now)).toBe(false)
  await db.update(notificationDeliveries).set({ status: 'failed' }).where(eq(notificationDeliveries.id, 'delivery'))
  expect(await operationalHealth(db, settings, now)).toBe(true)
})
