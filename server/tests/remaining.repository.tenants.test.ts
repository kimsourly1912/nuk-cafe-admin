import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PhotoEdit } from '#shared/contracts/media'
import * as media from '#server/features/media/media.repository'
import * as objects from '#server/features/media/media.objects.repository'
import { mediaAssets, mediaObjectDeletions } from '#server/features/media/media.schema'
import { imageSets, purgeExpiredUploads } from '#server/features/media/media.service'
import * as support from '#server/features/support/support.repository'
import { supportGrants, supportVisits } from '#server/features/support/support.schema'
import * as usage from '#server/features/assistant/assistant.repository'
import { assistantUsage } from '#server/features/assistant/assistant.schema'
import { finishUsage } from '#server/features/assistant/assistant.service'
import * as samples from '#server/features/sample-data/sample-data.repository'
import * as platform from '#server/features/platform/platform.repository'
import { listAuditEvents } from '#server/features/platform/platform.audit.repository'
import { dueMessages } from '#server/features/platform/platform.outbox.repository'
import { auditEvents, outboxMessages } from '#server/features/platform/platform.schema'
import { jobProgress, jobRunRows, readJobCursor, recordJobRun, saveJobCursor } from '#server/features/platform'
import type { Db, Statement } from '#server/utils/batch'
import { insertAll, requireOneChange, tryGuardedBatch } from '#server/utils/batch'
import { createTestDb, createUser, ensureTenant } from '#server/tests/support/db'
import { interleaved } from '#server/tests/support/interleave'

const OURS = 'ours'
const OTHER = 'other'
const NOW = new Date('2026-10-21T03:00:00Z')
const OLD = new Date(NOW.getTime() - 2 * 86400_000)
const UNTIL = new Date(NOW.getTime() + 60_000)
const EDIT: PhotoEdit = { focus: { x: 0.5, y: 0.5 }, card: { zoom: 1, x: 0.5, y: 0.5, adjusted: false }, detail: { zoom: 1, x: 0.5, y: 0.5, adjusted: false }, fill: '#ffffff' }
const RESULT = { outcome: 'ok' as const, inputTokens: 5, outputTokens: 2, cachedInputTokens: null }
let db: Db
let userId: string
const scope = (tenantId: string) => ({ tenantId, actorId: userId, operation: 'same.operation', key: 'same-key' })
const apply = async (statements: Statement[]) => {
  const [first, ...rest] = statements
  if (first) await db.batch([first, ...rest])
}

beforeEach(async () => {
  db = await createTestDb()
  userId = (await createUser(db)).id
  for (const tenantId of [OURS, OTHER]) {
    await ensureTenant(db, tenantId)
    await db.insert(mediaAssets).values({ id: tenantId, tenantId, objectKey: `${tenantId}/source`, mimeType: 'image/webp', byteSize: 1, sha256: 'a'.repeat(64), edit: EDIT, stateChangedAt: OLD })
    await db.insert(mediaAssets).values({ id: `${tenantId}-card`, tenantId, parentId: tenantId, variant: 'card', objectKey: `${tenantId}/card`, mimeType: 'image/webp', byteSize: 1, sha256: 'b'.repeat(64) })
    await db.insert(supportGrants).values({ id: tenantId, tenantId, grantedBy: userId, grantedAt: new Date(NOW.getTime() + (tenantId === OTHER ? 1 : 0)), expiresAt: UNTIL })
    await db.insert(supportVisits).values({ id: tenantId, tenantId, grantId: tenantId, userId, sessionId: 'same-session', openedAt: NOW, expiresAt: UNTIL })
    await apply(usage.reserveUsageStatements(db, { id: tenantId, tenantId, userId, day: '2026-10-21', feature: 'chat', provider: 'openai', model: 'test', at: NOW }, 1))
    await samples.claimNewRun(db, tenantId, { size: tenantId === OURS ? 'small' : 'standard', startedBy: userId, now: NOW })
    await db.batch([platform.insertIdempotencyKeyStatement(db, scope(tenantId), tenantId, { tenantId }, UNTIL)])
    await db.insert(auditEvents).values({ id: tenantId, tenantId, action: 'platform.test', actorId: userId, targetType: 'test', at: NOW })
    await db.insert(auditEvents).values({ id: `${tenantId}-private`, tenantId, action: 'cafe.private', targetType: 'test', at: NOW })
    await db.insert(outboxMessages).values({ id: tenantId, tenantId, kind: 'orders.ready', payload: { orderId: 'same-order' }, nextAttemptAt: NOW })
  }
})

describe('remaining repositories: two cafes (D194 step 7)', () => {
  it('keeps source and variant reads within the cafe, including a joined image batch', async () => {
    expect(await media.variantKeysOf(db, OURS, OTHER)).toEqual([])
    expect(await media.variantKeysOf(db, OTHER, OTHER)).toEqual([`${OTHER}/card`])
    expect(await media.findAsset(db, OURS, OTHER)).toBeUndefined()
    const rows = await media.imageRows(db, OURS, [OURS, OTHER])
    expect(rows.assets.map(r => r.id)).toEqual([OURS])
    expect(rows.variants).toEqual([{ parentId: OURS, variant: 'card', objectKey: `${OURS}/card` }])
    expect((await imageSets(db, OTHER, [OURS, OTHER])).get(OTHER)?.card).toBe(`/media/${OTHER}/source`)
    expect(await media.imageRows(db, OURS, [])).toEqual({ assets: [], variants: [] })
  })

  it('guards expired deletes and queues only that cafe\'s objects', async () => {
    expect(await tryGuardedBatch(db, [media.queueExpiredAssetObjectsStatement(db, OURS, OTHER, NOW), media.deleteExpiredAssetStatement(db, OURS, OTHER, NOW), requireOneChange(db)])).toBe(false)
    expect(await db.select().from(mediaObjectDeletions)).toEqual([])
    expect(await media.findAsset(db, OTHER, OTHER)).toBeDefined()
    expect(await tryGuardedBatch(db, [media.queueExpiredAssetObjectsStatement(db, OTHER, OTHER, NOW), media.deleteExpiredAssetStatement(db, OTHER, OTHER, NOW), requireOneChange(db)])).toBe(true)
    expect((await db.select().from(mediaObjectDeletions)).map(r => r.objectKey).sort()).toEqual([`${OTHER}/card`, `${OTHER}/source`])
    expect(await media.findAsset(db, OTHER, OTHER)).toBeUndefined()
    expect(await media.findAsset(db, OTHER, `${OTHER}-card`)).toBeUndefined()
    expect(await media.findAsset(db, OURS, OURS)).toBeDefined()
  })

  it('keeps a source attached between discovery and the purge batch, without deleting its R2 objects', async () => {
    const removed: string[] = []
    const racing = interleaved(db, async () => {
      await db.update(mediaAssets).set({ state: 'attached' }).where(eq(mediaAssets.id, OTHER))
    })
    const result = await purgeExpiredUploads(racing, { put: async () => {}, del: async (key) => {
      removed.push(key)
    } }, { now: NOW })
    expect(result).toMatchObject({ deleted: 1, kept: 1 })
    expect(await media.findAsset(db, OTHER, OTHER)).toMatchObject({ state: 'attached' })
    expect(await media.findAsset(db, OTHER, `${OTHER}-card`)).toBeDefined()
    expect(removed.some(key => key.startsWith(`${OTHER}/`))).toBe(false)
    expect(await db.select().from(mediaObjectDeletions)).toEqual([])
  })

  it('rolls deletion work back if the asset delete fails, before any R2 call', async () => {
    await db.run(sql`create trigger reject_asset_delete before delete on media_assets begin select raise(abort, 'delete unavailable'); end`)
    let calls = 0
    await expect(purgeExpiredUploads(db, { put: async () => {}, del: async () => {
      calls++
    } }, { now: NOW })).rejects.toThrow()
    expect(await db.select().from(mediaAssets)).toHaveLength(4)
    expect(await db.select().from(mediaObjectDeletions)).toEqual([])
    expect(calls).toBe(0)
  })

  it('resets only the named cafe\'s source and variants, retaining durable object work', async () => {
    await apply([objects.queueAssetObjectsStatement(db, OURS, OTHER), ...media.deleteAssetStatements(db, OURS, OTHER)])
    expect(await db.select().from(mediaAssets)).toHaveLength(4)
    expect(await db.select().from(mediaObjectDeletions)).toEqual([])
    await apply([objects.queueAssetObjectsStatement(db, OTHER, OTHER), ...media.deleteAssetStatements(db, OTHER, OTHER)])
    expect((await db.select().from(mediaAssets)).map(r => r.tenantId)).toEqual([OURS, OURS])
    expect(await db.select().from(mediaObjectDeletions)).toHaveLength(2)
  })

  it('acknowledges, retries and clears only its cafe\'s object work', async () => {
    await apply(objects.insertObjectPlansStatements(db, OTHER, ['other-object'], NOW))
    await apply([objects.retryObjectDeletionStatement(db, OURS, 'other-object', UNTIL), objects.deleteObjectStatement(db, OURS, 'other-object'), ...objects.deleteObjectPlansStatements(db, OURS, ['other-object'])])
    expect(await objects.dueObjectDeletions(db, NOW, 10)).toMatchObject([{ tenantId: OTHER, objectKey: 'other-object', nextAttemptAt: NOW }])
    await apply([objects.retryObjectDeletionStatement(db, OTHER, 'other-object', UNTIL)])
    expect(await objects.dueObjectDeletions(db, NOW, 10)).toEqual([])
    await apply([objects.deleteObjectStatement(db, OTHER, 'other-object')])
    expect(await db.select().from(mediaObjectDeletions)).toEqual([])
  })

  it('completes only a pending usage row of its cafe; daily quota stays per user and cafe', async () => {
    await finishUsage(db, OURS, OTHER, RESULT)
    expect((await db.select().from(assistantUsage).where(eq(assistantUsage.id, OTHER)))[0]).toMatchObject({ outcome: 'pending', inputTokens: null })
    await finishUsage(db, OTHER, OTHER, RESULT)
    await finishUsage(db, OTHER, OTHER, { ...RESULT, inputTokens: 99 })
    expect((await db.select().from(assistantUsage).where(eq(assistantUsage.id, OTHER)))[0]).toMatchObject({ outcome: 'ok', inputTokens: 5 })
    expect(await usage.countUsage(db, OURS, userId, '2026-10-21')).toBe(1)
    expect(await usage.countUsage(db, OTHER, userId, '2026-10-21')).toBe(1)
    const extra = usage.reserveUsageStatements(db, { id: 'over-limit', tenantId: OTHER, userId, day: '2026-10-21', feature: 'chat', provider: 'openai', model: 'test', at: NOW }, 1)
    expect(await tryGuardedBatch(db, [extra[0]!, ...extra.slice(1)])).toBe(false)
    expect(await usage.countUsage(db, OTHER, userId, '2026-10-21')).toBe(1)
  })

  it('scopes support reads, history and guards to the cafe at exact expiry', async () => {
    expect((await support.historyRows(db, OURS, 1)).grants.map(r => r.id)).toEqual([OURS])
    expect((await support.historyRows(db, OURS, 1)).visits.map(r => r.id)).toEqual([OURS])
    expect(await support.findActiveGrant(db, OURS, NOW)).toMatchObject({ id: OURS })
    expect(await support.findOpenVisit(db, OURS, 'same-session', NOW)).toMatchObject({ id: OURS, grantExpiresAt: UNTIL })
    expect(await support.findOpenVisit(db, OTHER, 'same-session', NOW)).toMatchObject({ id: OTHER })
    expect(await tryGuardedBatch(db, [support.requireGrantActive(db, OURS, OTHER, NOW)])).toBe(false)
    expect(await tryGuardedBatch(db, [support.requireNoActiveGrant(db, OURS, NOW)])).toBe(false)
    expect(await tryGuardedBatch(db, [support.requireGrantActive(db, OTHER, OTHER, NOW)])).toBe(true)
    expect(await tryGuardedBatch(db, [support.requireGrantActive(db, OTHER, OTHER, UNTIL)])).toBe(false)
    expect(await tryGuardedBatch(db, [support.requireNoActiveGrant(db, OTHER, UNTIL)])).toBe(true)
    expect(await support.findOpenVisit(db, OTHER, 'same-session', UNTIL)).toBeUndefined()
    await apply([support.endVisitStatement(db, OURS, OTHER, NOW), support.endGrantStatement(db, OURS, OTHER, userId, NOW), support.closeGrantVisitsStatement(db, OURS, OTHER, NOW)])
    expect(await support.findOpenVisit(db, OTHER, 'same-session', NOW)).toBeDefined()
    await apply([support.closeSessionVisitsStatement(db, OURS, 'same-session', NOW)])
    expect(await support.findOpenVisit(db, OURS, 'same-session', NOW)).toBeUndefined()
    expect(await support.findOpenVisit(db, OTHER, 'same-session', NOW)).toBeDefined()
  })

  it('keeps sample runs separate, and preserves strict lease expiry and completion', async () => {
    expect(await samples.findRun(db, OURS)).toMatchObject({ size: 'small' })
    expect(await samples.findRun(db, OTHER)).toMatchObject({ size: 'standard' })
    expect(await samples.claimNewRun(db, OURS, { size: 'large', startedBy: userId, now: NOW })).toBe(false)
    expect(await samples.claimRun(db, OURS, UNTIL, NOW)).toBe(true)
    expect(await samples.findRun(db, OTHER)).toMatchObject({ lockedUntil: null })
    expect(await samples.claimRun(db, OURS, new Date(UNTIL.getTime() + 60_000), UNTIL)).toBe(false)
    expect(await samples.claimRun(db, OTHER, UNTIL, NOW)).toBe(true)
    await apply([samples.releaseRunStatement(db, OURS, NOW)])
    expect(await samples.findRun(db, OTHER)).toMatchObject({ lockedUntil: UNTIL, finishedAt: null })
    expect(await samples.findRun(db, OURS)).toMatchObject({ lockedUntil: null, finishedAt: NOW })
    await apply([samples.deleteRunStatement(db, OURS)])
    expect(await samples.findRun(db, OURS)).toBeUndefined()
    expect(await samples.findRun(db, OTHER)).toBeDefined()
  })

  it('keeps idempotent responses separate and reads audit rows with the matching total', async () => {
    expect(await platform.findIdempotencyKey(db, scope(OURS))).toEqual({ requestHash: OURS, response: { tenantId: OURS } })
    expect(await platform.findIdempotencyKey(db, scope(OTHER))).toEqual({ requestHash: OTHER, response: { tenantId: OTHER } })
    const page = await listAuditEvents(db, { actions: ['platform.test'], tenantId: OURS, limit: 1, offset: 0 })
    expect(page).toMatchObject({ total: 1, rows: [{ tenantId: OURS, action: 'platform.test', at: NOW }] })
    expect(await listAuditEvents(db, { actions: ['platform.test'], limit: 1, offset: 2 })).toEqual({ total: 2, rows: [] })
    expect(await listAuditEvents(db, { actions: ['platform.test'], limit: 2, offset: 1 })).toMatchObject({ total: 2, rows: [{ tenantId: OTHER }] })
    expect(await dueMessages(db, NOW, 10, { order: { tenantId: OURS, orderId: 'same-order' } })).toMatchObject([{ id: OURS }])
  })

  it('reads large image/plan/target lists within D1\'s bind limit', async () => {
    const keys = Array.from({ length: 201 }, (_, i) => `key-${i}`)
    await apply(objects.insertObjectPlansStatements(db, OTHER, keys, NOW))
    expect(await objects.dueObjectDeletions(db, NOW, 300)).toHaveLength(201)
    await apply(objects.insertObjectPlansStatements(db, OTHER, keys, UNTIL))
    expect(await objects.dueObjectDeletions(db, NOW, 300)).toHaveLength(201)
    await apply(objects.deleteObjectPlansStatements(db, OURS, keys))
    expect(await objects.dueObjectDeletions(db, NOW, 300)).toHaveLength(201)
    await apply(objects.deleteObjectPlansStatements(db, OTHER, keys))
    expect(await objects.dueObjectDeletions(db, NOW, 300)).toEqual([])
    expect((await media.imageRows(db, OTHER, [...keys, OTHER, OURS])).assets.map(r => r.id)).toEqual([OTHER])
    expect((await dueMessages(db, NOW, 10, { ids: [...keys, OTHER], kinds: [...keys, 'orders.ready'] })).map(r => r.id)).toEqual([OTHER])
    expect(await dueMessages(db, NOW, 10, { ids: [] })).toEqual([])
    expect(await dueMessages(db, NOW, 10, { kinds: [] })).toEqual([])
    const workIds = Array.from({ length: 201 }, (_, i) => `work-${String(i).padStart(3, '0')}`)
    await apply(insertAll(db, outboxMessages, workIds.map(id => ({ id, tenantId: OTHER, kind: 'orders.ready', payload: {}, nextAttemptAt: NOW }))))
    expect((await dueMessages(db, NOW, 100, { ids: [...workIds].reverse() })).map(row => row.id)).toEqual(workIds.slice(0, 100))
  })

  it('preserves job success throttling, failure counts and last useful cursor progress', async () => {
    await recordJobRun(db, 'test-job', 'failure', NOW)
    await recordJobRun(db, 'test-job', 'success', UNTIL)
    await recordJobRun(db, 'test-job', 'success', new Date(UNTIL.getTime() + 1))
    expect(await jobRunRows(db)).toEqual([{ job: 'test-job', lastRunAt: UNTIL, lastSuccessAt: UNTIL, lastFailureAt: NOW, failuresInARow: 0 }])
    const boundary = new Date(UNTIL.getTime() + 5 * 60_000)
    await recordJobRun(db, 'test-job', 'success', boundary)
    expect(await jobRunRows(db)).toMatchObject([{ lastSuccessAt: boundary }])
    await saveJobCursor(db, 'test-job', OURS, { processed: 1, now: NOW })
    await saveJobCursor(db, 'test-job', OTHER, { processed: 1, failures: 1, now: UNTIL })
    expect(await readJobCursor(db, 'test-job')).toBe(OTHER)
    expect(await jobProgress(db, 'test-job')).toEqual({ activityAt: UNTIL, succeededAt: NOW, processed: 1, failures: 1 })
  })

  it('rolls every piece of a provisional object plan back if a later piece fails', async () => {
    await db.run(sql`create trigger reject_object_plan before insert on media_object_deletions when new.object_key = 'blocked' begin select raise(abort, 'plan unavailable'); end`)
    const keys = Array.from({ length: 201 }, (_, i) => i === 100 ? 'blocked' : `planned-${i}`)
    await expect(apply(objects.insertObjectPlansStatements(db, OURS, keys, NOW))).rejects.toThrow()
    expect(await db.select().from(mediaObjectDeletions)).toEqual([])
  })

  it('uses the image and support indexes in the actual batch SQL', async () => {
    const seen: { sql: string, params: unknown[] }[] = []
    const probe = new Proxy(db, {
      get(target, key, receiver) {
        if (key === 'batch') return (items: Parameters<Db['batch']>[0]) => {
          for (const item of items) seen.push((item as unknown as { toSQL: () => { sql: string, params: unknown[] } }).toSQL())
          return target.batch(items)
        }
        return Reflect.get(target, key, receiver)
      },
    })
    await media.imageRows(probe, OURS, [OURS, OTHER])
    await support.historyRows(probe, OURS, 10)
    expect(seen).toHaveLength(4)
    const client = (db as unknown as { $client: { execute: (query: { sql: string, args: unknown[] }) => Promise<{ rows: Record<string, unknown>[] }> } }).$client
    const plans: string[][] = []
    for (const query of seen) plans.push((await client.execute({ sql: `explain query plan ${query.sql}`, args: query.params })).rows.map(row => String(row.detail)))
    expect(plans[0]!.join('\n')).toMatch(/INDEX.*media_assets/)
    expect(plans[1]!.join('\n')).toContain('media_assets_parent_idx')
    expect(plans[2]!.join('\n')).toContain('support_grants_tenant_idx')
    expect(plans[3]!.join('\n')).toContain('support_visits_grant_idx')
  })
})
