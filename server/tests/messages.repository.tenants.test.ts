import { eq, sql } from 'drizzle-orm'
import { Api } from 'grammy'
import { beforeEach, describe, expect, it } from 'vitest'
import * as destinations from '#server/features/notifications/notifications.repository'
import * as deliveries from '#server/features/notifications/notifications.deliveries.repository'
import * as alerts from '#server/features/notifications/notifications.customers.repository'
import * as links from '#server/features/notifications/notifications.links.repository'
import * as channels from '#server/features/marketing/marketing.repository'
import * as posts from '#server/features/marketing/marketing.posts.repository'
import * as channelLinks from '#server/features/marketing/marketing.links.repository'
import { notificationDeliveries, notificationRules, orderReadyAlerts, telegramDestinations, telegramLinks } from '#server/features/notifications/notifications.schema'
import { marketingChannelLinks, marketingChannels, marketingPosts } from '#server/features/marketing/marketing.schema'
import { menuPromotions } from '#server/features/menu/menu.schema'
import { orders } from '#server/features/orders/orders.schema'
import { markDelivered, retryDelivery, setNotificationRule } from '#server/features/notifications/notifications.delivery'
import { createAdmin, createTestDb, insertBranch } from '#server/tests/support/db'
import type { Db } from '#server/utils/batch'
import { insertAll, requireOneChange, tryGuardedBatch } from '#server/utils/batch'

// Repository-level isolation: passing a checked parent id is never a substitute for the row's cafe.
const OURS = 'ours'
const OTHER = 'other'
const NOW = new Date('2026-10-20T03:00:00Z')
const UNTIL = new Date(NOW.getTime() + 60_000)
let db: Db
let owner: string

beforeEach(async () => {
  db = await createTestDb()
  for (const tenantId of [OURS, OTHER]) {
    const admin = await createAdmin(db, `${tenantId}@example.com`, tenantId)
    if (tenantId === OTHER) owner = admin.userId
    await insertBranch(db, { id: tenantId, tenantId, name: tenantId, timezone: 'Asia/Phnom_Penh' })
    await db.insert(telegramDestinations).values({ id: tenantId, tenantId, kind: 'private', chatId: tenantId, title: tenantId, connectedBy: admin.userId, connectedAt: NOW })
    await db.insert(notificationRules).values({ tenantId, kind: 'closing_summary', destinationId: tenantId, attachCsv: false })
    await db.insert(notificationDeliveries).values({ id: tenantId, tenantId, kind: 'report', destinationId: tenantId, dedupeKey: 'same-key', subject: tenantId, message: { html: tenantId }, nextAttemptAt: NOW, createdAt: NOW })
    await db.insert(telegramLinks).values({ id: tenantId, tenantId, kind: 'private', codeHash: tenantId, createdBy: admin.userId, expiresAt: UNTIL })
    await db.insert(marketingChannelLinks).values({ id: tenantId, tenantId, codeHash: tenantId, createdBy: admin.userId, expiresAt: UNTIL })
    await db.insert(marketingChannels).values({ id: tenantId, tenantId, kind: 'telegram_channel', externalId: tenantId, title: tenantId, connectedAt: NOW })
    await db.insert(menuPromotions).values({ id: tenantId, tenantId, name: tenantId, discountKind: 'percent', percent: 10, scope: 'menu', startsOn: '2026-10-20' })
    await db.insert(marketingPosts).values({ id: tenantId, tenantId, promotionId: tenantId, channelId: tenantId, caption: tenantId, message: { html: tenantId, button: { text: 'Menu', url: 'https://example.com' } }, scheduledAt: NOW, nextAttemptAt: NOW })
    await db.insert(orders).values({ id: tenantId, tenantId, branchId: tenantId, customerId: admin.userId, businessDate: '2026-10-20', pickupNumber: 1, orderType: 'pickup', subtotalMinor: 100, totalMinor: 100, placedAt: NOW, paymentDueAt: UNTIL })
    await db.insert(orderReadyAlerts).values({ orderId: tenantId, tenantId, codeHash: tenantId, linkExpiresAt: UNTIL })
  }
})

describe('messages repository tenant boundaries (D194)', () => {
  it('reads only the requested cafe, including deduplication and joined overview rows', async () => {
    expect(await deliveries.findDeliveryIds(db, OURS, [OTHER])).toEqual(new Set())
    expect(await deliveries.findDeliveryIds(db, OTHER, [OTHER])).toEqual(new Set([OTHER]))
    expect(await deliveries.deliveredTo(db, OURS, 'same-key', [OTHER])).toEqual(new Set())
    expect(await deliveries.deliveredTo(db, OTHER, 'same-key', [OTHER])).toEqual(new Set([OTHER]))
    expect(await deliveries.findDelivery(db, OURS, OTHER)).toBeUndefined()
    expect(await deliveries.findDelivery(db, OTHER, OTHER)).toMatchObject({ title: OTHER, delivery: { id: OTHER } })
    expect((await deliveries.listRecentDeliveries(db, OURS, 10)).map(r => r.delivery.id)).toEqual([OURS])
    expect((await destinations.overviewRows(db, OURS)).destinations.map(r => r.id)).toEqual([OURS])
    expect((await destinations.overviewRows(db, OTHER)).rules).toEqual([{ kind: 'closing_summary', destinationId: OTHER, attachCsv: false }])
    expect(await destinations.targetsOf(db, OURS, 'closing_summary')).toEqual([{ destinationId: OURS, attachCsv: false }])
    expect(await links.findLink(db, OURS, OTHER)).toBeUndefined()
    expect(await channelLinks.findLink(db, OURS, OTHER)).toBeUndefined()
    expect(await channels.findChannels(db, OURS, [OTHER])).toEqual([])
    expect(await posts.findPosts(db, OURS, [OTHER])).toEqual([])
    expect(await posts.findPosts(db, OTHER, [OTHER])).toMatchObject([{ id: OTHER, channelTitle: OTHER }])
    expect(await alerts.findOrderReadyAlert(db, OURS, OTHER)).toBeUndefined()
  })

  it('does not stamp another cafe\'s destination or edit its rule, even on a conflict', async () => {
    await db.batch([destinations.sentStatement(db, OURS, OTHER, NOW)])
    expect(await destinations.findDestination(db, OTHER, OTHER)).toMatchObject({ lastSentAt: null })
    await db.batch([destinations.upsertRuleStatement(db, { tenantId: OURS, kind: 'closing_summary', destinationId: OTHER, attachCsv: true, createdBy: owner })])
    expect(await destinations.listRules(db, OTHER)).toMatchObject([{ attachCsv: false }])
    await db.batch([destinations.deleteRuleStatement(db, OURS, 'closing_summary', OTHER)])
    expect(await destinations.listRules(db, OTHER)).toHaveLength(1)
    await db.batch([destinations.sentStatement(db, OTHER, OTHER, NOW), destinations.upsertRuleStatement(db, { tenantId: OTHER, kind: 'closing_summary', destinationId: OTHER, attachCsv: true, createdBy: owner })])
    expect(await destinations.findDestination(db, OTHER, OTHER)).toMatchObject({ lastSentAt: NOW })
    expect(await destinations.listRules(db, OTHER)).toMatchObject([{ attachCsv: true }])
    await db.batch([destinations.deleteRuleStatement(db, OTHER, 'closing_summary', OTHER)])
    expect(await destinations.listRules(db, OTHER)).toEqual([])
  })

  for (const [name, repo] of [['notification', links], ['marketing', channelLinks]] as const) {
    it(`${name}: advances and cancels only its cafe's code`, async () => {
      expect(await tryGuardedBatch(db, [repo.advanceLinkStatement(db, OURS, OTHER, ['waiting'], { status: 'confirm' }, NOW), requireOneChange(db)])).toBe(false)
      expect(await repo.findLink(db, OTHER, OTHER)).toMatchObject({ status: 'waiting' })
      expect(await tryGuardedBatch(db, [repo.cancelLinkStatement(db, OURS, OTHER), requireOneChange(db)])).toBe(false)
      expect(await repo.findLink(db, OTHER, OTHER)).toMatchObject({ status: 'waiting' })
      expect(await tryGuardedBatch(db, [repo.advanceLinkStatement(db, OTHER, OTHER, ['waiting'], { status: 'confirm' }, NOW), requireOneChange(db)])).toBe(true)
      expect(await tryGuardedBatch(db, [repo.cancelLinkStatement(db, OTHER, OTHER), requireOneChange(db)])).toBe(true)
    })

    it(`${name}: rejects used or expired codes, but permits cancellation of an expired waiting code`, async () => {
      expect(await tryGuardedBatch(db, [repo.advanceLinkStatement(db, OTHER, OTHER, ['waiting'], { status: 'confirm' }, UNTIL), requireOneChange(db)])).toBe(false)
      expect(await tryGuardedBatch(db, [repo.advanceLinkStatement(db, OTHER, OTHER, ['confirm'], { status: 'connected' }, NOW), requireOneChange(db)])).toBe(false)
      expect(await tryGuardedBatch(db, [repo.advanceLinkStatement(db, OTHER, OTHER, ['waiting'], { status: 'connected' }, NOW), requireOneChange(db)])).toBe(true)
      expect(await tryGuardedBatch(db, [repo.cancelLinkStatement(db, OTHER, OTHER), requireOneChange(db)])).toBe(false)
      expect(await tryGuardedBatch(db, [repo.cancelLinkStatement(db, OURS, OURS), requireOneChange(db)])).toBe(true)
    })
  }

  it('claims deliveries only within their cafe and fences every settlement by cafe and token', async () => {
    expect(await deliveries.claimDelivery(db, OURS, OTHER, UNTIL, NOW)).toBeUndefined()
    const claim = (await deliveries.claimDelivery(db, OTHER, OTHER, UNTIL, NOW))!
    expect(claim.attempts).toBe(1)
    expect(await deliveries.claimDelivery(db, OTHER, OTHER, UNTIL, NOW)).toBeUndefined()
    expect(await deliveries.markRetry(db, OURS, OTHER, claim.claimToken, NOW, 'retry')).toBe(false)
    expect(await deliveries.markFailed(db, OURS, OTHER, claim.claimToken, 'failed')).toBe(false)
    expect(await markDelivered(db, OURS, OTHER, claim.claimToken, OTHER, NOW)).toBe(false)
    expect(await markDelivered(db, OTHER, OTHER, 'wrong-token', OTHER, NOW)).toBe(false)
    expect(await destinations.findDestination(db, OTHER, OTHER)).toMatchObject({ lastSentAt: null })
    expect(await deliveries.markRetry(db, OTHER, OTHER, claim.claimToken, NOW, 'retry')).toBe(true)
    const next = (await deliveries.claimDelivery(db, OTHER, OTHER, UNTIL, NOW))!
    expect(next.attempts).toBe(2)
    expect(await deliveries.markFailed(db, OTHER, OTHER, next.claimToken, 'failed')).toBe(true)
    expect(await tryGuardedBatch(db, [deliveries.requeueFailedStatement(db, OURS, OTHER, NOW), requireOneChange(db)])).toBe(false)
    expect(await deliveries.findDelivery(db, OTHER, OTHER)).toMatchObject({ delivery: { status: 'failed' } })
    expect(await tryGuardedBatch(db, [deliveries.requeueFailedStatement(db, OTHER, OTHER, NOW), requireOneChange(db)])).toBe(true)
    expect(await tryGuardedBatch(db, [deliveries.requeueFailedStatement(db, OTHER, OTHER, NOW), requireOneChange(db)])).toBe(false)
    const last = (await deliveries.claimDelivery(db, OTHER, OTHER, UNTIL, NOW))!
    expect(await markDelivered(db, OTHER, OTHER, last.claimToken, OTHER, NOW)).toBe(true)
    expect(await destinations.findDestination(db, OTHER, OTHER)).toMatchObject({ lastSentAt: NOW })
  })

  it('claims and settles marketing posts only in their cafe', async () => {
    expect(await posts.claimPost(db, OURS, OTHER, UNTIL, NOW)).toBeUndefined()
    const claim = (await posts.claimPost(db, OTHER, OTHER, UNTIL, NOW))!
    expect(claim.attempts).toBe(1)
    expect(await posts.claimPost(db, OTHER, OTHER, UNTIL, NOW)).toBeUndefined()
    expect(await posts.settlePost(db, OURS, OTHER, claim.claimToken, { status: 'sent' })).toBe(false)
    expect(await posts.settlePost(db, OTHER, OTHER, 'wrong-token', { status: 'sent' })).toBe(false)
    expect(await posts.settlePost(db, OTHER, OTHER, claim.claimToken, { status: 'sent' })).toBe(true)
  })

  it('keeps ready links, code redemption and claims inside their cafe', async () => {
    await db.batch([alerts.upsertOrderReadyLinkStatement(db, { tenantId: OURS, orderId: OTHER, codeHash: 'replacement', linkExpiresAt: NOW, createdAt: NOW })])
    expect(await alerts.findOrderReadyAlert(db, OTHER, OTHER)).toMatchObject({ codeHash: OTHER, linkExpiresAt: UNTIL })
    expect(await tryGuardedBatch(db, [alerts.subscribeOrderReadyAlertStatement(db, OURS, OTHER, OTHER, 'chat', 'sub', NOW), requireOneChange(db)])).toBe(false)
    expect(await tryGuardedBatch(db, [alerts.subscribeOrderReadyAlertStatement(db, OTHER, OTHER, OTHER, 'chat', 'sub', NOW), requireOneChange(db)])).toBe(true)
    expect(await alerts.claimOrderReady(db, OURS, OTHER, UNTIL, NOW)).toBeUndefined()
    const claim = (await alerts.claimOrderReady(db, OTHER, OTHER, UNTIL, NOW))!
    expect(await alerts.hasOrderReadyClaim(db, OURS, OTHER, NOW)).toBe(false)
    expect(await alerts.hasOrderReadyClaim(db, OTHER, OTHER, NOW)).toBe(true)
    expect(await alerts.markOrderReadyComplete(db, { ...claim, tenantId: OURS }, NOW)).toBe(false)
    expect(await alerts.markOrderReadyComplete(db, claim, NOW)).toBe(true)
  })

  it('rolls a rule change back when its audit cannot be recorded', async () => {
    await db.run(sql`create trigger reject_rule_audit before insert on audit_events begin select raise(abort, 'audit unavailable'); end`)
    await expect(setNotificationRule(db, { userId: owner, tenantId: OTHER, role: 'owner' }, { kind: 'closing_summary', destinationId: OTHER, enabled: false, attachCsv: false })).rejects.toThrow()
    expect(await destinations.listRules(db, OTHER)).toHaveLength(1)
  })

  it('rolls a manual retry back when its audit fails, before any provider call', async () => {
    await db.update(notificationDeliveries).set({ status: 'failed' }).where(eq(notificationDeliveries.id, OTHER))
    await db.run(sql`create trigger reject_retry_audit before insert on audit_events begin select raise(abort, 'audit unavailable'); end`)
    let sends = 0
    const api = new Api('123:test', { fetch: (async () => {
      sends++
      throw new Error('unexpected send')
    }) as typeof fetch })
    await expect(retryDelivery(db, api, { userId: owner, tenantId: OTHER, role: 'owner' }, OTHER, NOW)).rejects.toThrow()
    expect(await deliveries.findDelivery(db, OTHER, OTHER)).toMatchObject({ delivery: { status: 'failed', attempts: 0 } })
    expect(sends).toBe(0)
  })

  it('reads large id sets in D1-sized pieces and merges due work in a stable order', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `delivery-${String(i).padStart(3, '0')}`)
    const rows = ids.map(id => ({ id, tenantId: OTHER, destinationId: OTHER, kind: 'report' as const, dedupeKey: id, subject: id, message: { html: id }, nextAttemptAt: NOW }))
    const statements = insertAll(db, notificationDeliveries, rows)
    await db.batch([statements[0]!, ...statements.slice(1)])
    expect(await deliveries.findDeliveryIds(db, OTHER, [...ids, 'missing'])).toEqual(new Set(ids))
    expect(await deliveries.deliveredTo(db, OTHER, 'same-key', [...ids, OTHER])).toEqual(new Set([OTHER]))
    expect((await deliveries.dueDeliveries(db, NOW, 100, [...ids].reverse())).map(r => r.id)).toEqual(ids.slice(0, 100))
    expect((await posts.duePosts(db, NOW, 10, [...ids, OTHER])).map(r => r.id)).toEqual([OTHER])
    expect((await channels.findChannels(db, OTHER, [...ids, OTHER])).map(r => r.id)).toEqual([OTHER])
    expect((await posts.findPosts(db, OTHER, [...ids, OTHER])).map(r => r.id)).toEqual([OTHER])
    expect(await deliveries.findDeliveryIds(db, OTHER, [])).toEqual(new Set())
    expect(await deliveries.deliveredTo(db, OTHER, 'same-key', [])).toEqual(new Set())
    expect(await deliveries.dueDeliveries(db, NOW, 10, [])).toEqual([])
    expect(await posts.duePosts(db, NOW, 10, [])).toEqual([])
  })

  it('uses the indexed destination and delivery lists', async () => {
    const destinationPlan = await db.all<{ detail: string }>(sql`explain query plan select id from telegram_destinations where tenant_id = ${OTHER} and status <> 'disconnected' order by connected_at, id`)
    const deliveryPlan = await db.all<{ detail: string }>(sql`explain query plan select id from notification_deliveries where tenant_id = ${OTHER} order by created_at desc, id desc limit 10`)
    expect(destinationPlan.map(r => r.detail).join('\n')).toMatch(/telegram_destinations_status_idx/)
    expect(deliveryPlan.map(r => r.detail).join('\n')).toMatch(/notification_deliveries_tenant_created_idx/)
  })

  it('cleans old link codes in bounded passes across cafes, keeping marketing connected links', async () => {
    const expired = new Date(NOW.getTime() - 1)
    const old = Array.from({ length: 501 }, (_, i) => ({ id: `old-${i}`, tenantId: i % 2 ? OURS : OTHER, codeHash: `old-${i}`, createdBy: owner, expiresAt: expired }))
    const notificationInserts = insertAll(db, telegramLinks, old.map(row => ({ ...row, kind: 'group' as const })))
    const marketingInserts = insertAll(db, marketingChannelLinks, old)
    await db.batch([notificationInserts[0]!, ...notificationInserts.slice(1), ...marketingInserts,
      db.insert(marketingChannelLinks).values({ id: 'old-connected', tenantId: OTHER, codeHash: 'old-connected', createdBy: owner, expiresAt: expired, status: 'connected' }),
    ])
    expect(await links.deleteLinksBefore(db, NOW)).toBe(500)
    expect(await links.deleteLinksBefore(db, NOW)).toBe(1)
    expect(await links.deleteLinksBefore(db, NOW)).toBe(0)
    expect(await channelLinks.deleteLinksBefore(db, NOW)).toBe(500)
    expect(await channelLinks.deleteLinksBefore(db, NOW)).toBe(1)
    expect(await channelLinks.deleteLinksBefore(db, NOW)).toBe(0)
    expect(await links.findLink(db, OURS, OURS)).toBeDefined()
    expect(await channelLinks.findLink(db, OTHER, 'old-connected')).toMatchObject({ status: 'connected' })
  })
})
