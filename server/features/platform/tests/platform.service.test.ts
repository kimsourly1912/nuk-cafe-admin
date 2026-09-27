import { count, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { requireOneChange } from '../../../utils/batch'
import type { Db } from '../../../utils/batch'
import { apiError } from '../../../utils/errors'
import { newId } from '../../../utils/ids'
import { createTestDb } from '../../../tests/support/db'
import { expectApiError } from '../../../tests/support/failure'
import { auditEvents, idempotencyKeys, outboxMessages } from '../platform.schema'
import { auditStatement, deliverOutbox, expireIdempotencyKeys, outboxStatement, withIdempotency } from '../platform.service'
import { canonicalJson, OUTBOX_MAX_ATTEMPTS, retryDelayMs } from '../platform.rules'
import type { OutboxHandler } from '../platform.types'

let db: Db

beforeEach(async () => {
  db = await createTestDb()
})

/** A stand-in action: one audit row per run, so "ran once" is a row count. */
const scope = { actorId: 'user-1', operation: 'test.action', key: '5a7e1b0c-2d1f-4f9a-9d8e-3c2b1a0f9e8d' }
function action(label: string) {
  return async () => ({
    statements: [auditStatement(db, { userId: 'user-1' }, { action: 'test.action', targetType: 'thing', targetId: label })],
    response: { label, id: newId() },
  })
}
/** Resolves when `count` callers have arrived; lets racing calls meet at the same point. */
function meetingPoint(count: number) {
  let arrived = 0
  let open!: () => void
  const all = new Promise<void>((resolve) => {
    open = resolve
  })
  return async () => {
    if (++arrived === count) open()
    await all
  }
}

const auditCount = async () => (await db.select({ n: count() }).from(auditEvents))[0]!.n

describe('audit', () => {
  it('records actor, request id, branch and metadata', async () => {
    await db.batch([auditStatement(db, { userId: 'user-1', requestId: 'req-1' }, { action: 'menu.item.update', targetType: 'menu_item', targetId: 'item-1', branchId: 'branch-1', metadata: { fields: ['name'] } })])
    const [row] = await db.select().from(auditEvents)
    expect(row).toMatchObject({ actorId: 'user-1', requestId: 'req-1', action: 'menu.item.update', targetType: 'menu_item', targetId: 'item-1', branchId: 'branch-1', metadata: { fields: ['name'] } })
    expect(row!.at).toBeInstanceOf(Date)
  })
})

describe('idempotency', () => {
  it('runs the action once and replays the stored response without building it again', async () => {
    const first = await withIdempotency(db, scope, { amount: 5 }, action('a'))
    let built = false
    const again = await withIdempotency(db, scope, { amount: 5 }, async () => {
      built = true
      return action('b')()
    })
    expect(first.replayed).toBe(false)
    expect(again).toEqual({ response: first.response, replayed: true })
    expect(built).toBe(false)
    expect(await auditCount()).toBe(1)
  })

  it('treats the same request with keys in another order as the same', async () => {
    await withIdempotency(db, scope, { a: 1, b: { c: 2, d: 3 } }, action('a'))
    await expect(withIdempotency(db, scope, { b: { d: 3, c: 2 }, a: 1 }, action('b'))).resolves.toMatchObject({ replayed: true })
  })

  it('refuses the same key with a different request', async () => {
    await withIdempotency(db, scope, { amount: 5 }, action('a'))
    await expectApiError(() => withIdempotency(db, scope, { amount: 6 }, action('b')), 422, 'IDEMPOTENCY_MISMATCH')
    expect(await auditCount()).toBe(1)
  })

  it('keeps keys apart per actor and per operation', async () => {
    await withIdempotency(db, scope, { amount: 5 }, action('a'))
    await withIdempotency(db, { ...scope, actorId: 'user-2' }, { amount: 5 }, action('b'))
    await withIdempotency(db, { ...scope, operation: 'test.other' }, { amount: 5 }, action('c'))
    expect(await auditCount()).toBe(3)
  })

  it('applies two simultaneous identical requests once; both get the same response', async () => {
    // Both have checked for the key and built their action before either commits.
    const bothBuilt = meetingPoint(2)
    const racing = (label: string) => async () => {
      const work = await action(label)()
      await bothBuilt()
      return work
    }
    const [one, two] = await Promise.all([
      withIdempotency(db, scope, { amount: 5 }, racing('a')),
      withIdempotency(db, scope, { amount: 5 }, racing('b')),
    ])
    expect(one.response).toEqual(two.response)
    expect([one.replayed, two.replayed].sort()).toEqual([false, true])
    expect(await auditCount()).toBe(1)
  })

  it('stores nothing when the action fails, so a retry runs it', async () => {
    const failing = async () => ({ statements: [db.insert(auditEvents).values({ action: 'x', targetType: 'x' }), requireOneChange(db), db.run('select json(\'broken\')')], response: {} })
    await expect(withIdempotency(db, scope, { amount: 5 }, failing, { onStale: () => apiError(409, 'VERSION_CONFLICT', 'Changed') })).rejects.toMatchObject({ statusCode: 409 })
    expect(await db.select().from(idempotencyKeys)).toEqual([])
    expect(await auditCount()).toBe(0)
    await expect(withIdempotency(db, scope, { amount: 5 }, action('a'))).resolves.toMatchObject({ replayed: false })
  })

  it('removes keys once they are 24 hours old', async () => {
    const start = new Date('2026-09-27T10:00:00Z')
    await withIdempotency(db, scope, { amount: 5 }, action('a'), { now: start })
    expect(await expireIdempotencyKeys(db, new Date(start.getTime() + 23 * 3600_000))).toBe(0)
    expect(await expireIdempotencyKeys(db, new Date(start.getTime() + 24 * 3600_000 + 1))).toBe(1)
    // After expiry the key is free again.
    await expect(withIdempotency(db, scope, { amount: 6 }, action('b'))).resolves.toMatchObject({ replayed: false })
  })

  it('hashes canonical JSON: key order and undefined fields don\'t matter', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: undefined, c: 3 }] })).toBe('{"a":[2,{"c":3}],"b":1}')
  })
})

describe('outbox', () => {
  const T0 = new Date('2026-09-27T10:00:00Z')
  const at = (ms: number) => new Date(T0.getTime() + ms)

  async function enqueue(kind = 'mail.test', payload: Record<string, unknown> = { to: 'user-1' }) {
    await db.batch([outboxStatement(db, kind, payload)])
    // Created "now" by SQLite; move it to T0 so the tests control time.
    await db.update(outboxMessages).set({ nextAttemptAt: T0 })
  }
  const mailTest = (handler: OutboxHandler) => ({ 'mail.test': handler })
  const message = async () => (await db.select().from(outboxMessages))[0]!

  it('delivers a message once and marks it sent', async () => {
    await enqueue()
    const seen: unknown[] = []
    const handlers = mailTest(async (m) => {
      seen.push(m)
    })
    expect(await deliverOutbox(db, handlers, { now: T0 })).toMatchObject({ sent: 1, retried: 0, failed: 0 })
    expect(seen).toEqual([expect.objectContaining({ kind: 'mail.test', payload: { to: 'user-1' }, attempt: 1 })])
    expect(await message()).toMatchObject({ status: 'sent', attempts: 1, lockedUntil: null })
    expect(await deliverOutbox(db, handlers, { now: at(3600_000) })).toMatchObject({ sent: 0 })
    expect(seen).toHaveLength(1)
  })

  it('retries a failure with backoff, then succeeds', async () => {
    await enqueue()
    let calls = 0
    const handlers = mailTest(async () => {
      if (++calls === 1) throw new Error('Mail API down\n  at stack')
    })

    expect(await deliverOutbox(db, handlers, { now: T0 })).toMatchObject({ retried: 1, failures: [{ attempt: 1, final: false, error: 'Mail API down at stack' }] })
    expect(await message()).toMatchObject({ status: 'pending', attempts: 1, lastError: 'Mail API down at stack', nextAttemptAt: at(retryDelayMs(1)) })
    // Not due yet.
    expect(await deliverOutbox(db, handlers, { now: at(retryDelayMs(1) - 1) })).toMatchObject({ sent: 0, retried: 0 })
    expect(await deliverOutbox(db, handlers, { now: at(retryDelayMs(1)) })).toMatchObject({ sent: 1 })
    expect(await message()).toMatchObject({ status: 'sent', attempts: 2, lastError: null })
  })

  it('gives up after the last attempt and marks the message failed', async () => {
    await enqueue('mail.unknown')
    let now = T0
    for (let attempt = 1; attempt <= OUTBOX_MAX_ATTEMPTS; attempt++) {
      const report = await deliverOutbox(db, {}, { now })
      expect(report.failures[0]).toMatchObject({ attempt, final: attempt === OUTBOX_MAX_ATTEMPTS, error: 'No handler for outbox messages of kind "mail.unknown"' })
      now = new Date(now.getTime() + retryDelayMs(attempt))
    }
    expect(await message()).toMatchObject({ status: 'failed', attempts: OUTBOX_MAX_ATTEMPTS })
    expect(await deliverOutbox(db, {}, { now: at(30 * 86400_000) })).toMatchObject({ sent: 0, retried: 0, failed: 0 })
  })

  it('never lets two runs that both found the message send it twice', async () => {
    await enqueue()
    let sends = 0
    const handlers = mailTest(async () => {
      sends++
    })
    // Both runs read the due list before either claims: only the claim can keep them apart.
    const [one, two] = await Promise.all([deliverOutbox(db, handlers, { now: T0 }), deliverOutbox(db, handlers, { now: T0 })])
    expect(sends).toBe(1)
    expect([one.sent, two.sent].sort()).toEqual([0, 1])
    expect(one.skipped + two.skipped).toBe(1)
  })

  it('never lets a run send a message another run holds', async () => {
    await enqueue()
    let sends = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const handlers = mailTest(async () => {
      sends++
      await gate
    })

    const first = deliverOutbox(db, handlers, { now: T0 })
    await new Promise(resolve => setTimeout(resolve, 20))
    const second = await deliverOutbox(db, handlers, { now: T0 })
    release()
    expect(await first).toMatchObject({ sent: 1 })
    expect(second).toMatchObject({ sent: 0 })
    expect(sends).toBe(1)
  })

  it('sends again when a run died holding a message and its claim has expired', async () => {
    await enqueue()
    const [row] = await db.select({ id: outboxMessages.id }).from(outboxMessages)
    // A run claimed it and then crashed (no sent, no retry recorded).
    await db.update(outboxMessages).set({ lockedUntil: at(60_000), attempts: 1 }).where(eq(outboxMessages.id, row!.id))
    const handlers = mailTest(async () => {})
    expect(await deliverOutbox(db, handlers, { now: at(30_000) })).toMatchObject({ sent: 0 })
    expect(await deliverOutbox(db, handlers, { now: at(60_000) })).toMatchObject({ sent: 1 })
    expect(await message()).toMatchObject({ status: 'sent', attempts: 2 })
  })

  it('commits a message only with the change that caused it', async () => {
    const statements = [outboxStatement(db, 'mail.test', {}), db.run('select json(\'broken\')')]
    await expect(db.batch(statements as [typeof statements[0], ...typeof statements])).rejects.toThrow()
    expect(await db.select().from(outboxMessages)).toEqual([])
  })
})
