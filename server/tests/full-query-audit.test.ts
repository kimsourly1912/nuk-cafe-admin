import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { SQLiteInsertValue, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { expect, it } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { member, organization, user } from '#server/db/tables'
import { insertBranch, migrationFiles } from '#server/tests/support/db'
import type { Db } from '#server/utils/batch'
import { chunk, insertPieces } from '#server/utils/batch'
import { findTenantRole } from '#server/features/identity/identity.repository'
import { listAccounts } from '#server/features/identity/accounts.repository'
import { listPublicBranches } from '#server/features/branches'
import { activeCafe, listActiveTenants } from '#server/features/tenants/tenants.repository'
import { findCustomerOrdersInProgress, orderActivity, requireUnpaidAtMost } from '#server/features/orders/orders.repository'
import { reportSummary } from '#server/features/orders/reports.service'
import { getOrder, listMyOrders } from '#server/features/orders/orders.service'
import { orders } from '#server/features/orders/orders.schema'
import { redactExpiredMail } from '#server/features/platform/platform.outbox.repository'
import { outboxMessages } from '#server/features/platform/platform.schema'
import { dueExpiredTemporary } from '#server/features/media/media.repository'
import { mediaAssets } from '#server/features/media/media.schema'
import { catalogRows } from '#server/features/menu/catalog.repository'
import { listItems } from '#server/features/menu/items.repository'
import { menuCategories, menuItems, menuItemVariations } from '#server/features/menu/menu.schema'

interface Query { sql: string, params: unknown[] }
interface Result { results: Record<string, unknown>[], meta: { rows_read: number, rows_written: number, duration: number } }
interface Prepared { bind: (...params: unknown[]) => Prepared, all: () => Promise<Result>, run: () => Promise<Result> }
interface AuditD1 { prepare: (sql: string) => Prepared, batch: (statements: Prepared[]) => Promise<Result[]> }

/** Opt-in experiments on a disposable local D1. Candidate indexes/SQL never change app code. */
it.runIf(Boolean(process.env.QUERY_AUDIT))('records full-query audit experiments on local D1', { tags: ['slow'], timeout: 180_000 }, async () => {
  const proxy = await getPlatformProxy({ configPath: fileURLToPath(new URL('./support/d1-wrangler.json', import.meta.url)), persist: false })
  const d1 = proxy.env.DB as AuditD1
  const evidence: Record<string, unknown> = { baseline: 'ac1b659c3e91455f91acbccce692214eec706a98', runtime: 'local workerd/D1; synthetic data only', statistics: 'ANALYZE before candidate comparisons; no cold-plan speedup claim', experiments: [] }
  const experiments = evidence.experiments as unknown[]
  const now = new Date('2026-10-27T05:00:00Z')
  const old = new Date('2026-01-01T05:00:00Z')
  const seen: Query[] = []
  let batchCalls = 0
  let batchedStatements = 0
  const db = drizzle(d1 as never, { casing: 'snake_case', logger: { logQuery: (statement, params) => seen.push({ sql: statement, params }) } }) as unknown as Db
  const batch = db.batch.bind(db)
  db.batch = ((items) => {
    batchCalls++
    batchedStatements += items.length
    for (const item of items) seen.push((item as unknown as { toSQL: () => Query }).toSQL())
    return batch(items)
  }) as typeof db.batch
  const capture = async (action: () => Promise<unknown>) => {
    seen.length = 0
    batchCalls = 0
    batchedStatements = 0
    const value = await action()
    return { value, queries: [...seen], batchCalls, calls: seen.length - batchedStatements + batchCalls }
  }
  const measure = async (query: Query) => {
    const plan = await d1.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).bind(...query.params).all()
    const result = await d1.prepare(query.sql).bind(...query.params).all()
    return { result, plan: plan.results.map(row => String(row.detail)), rowsRead: result.meta.rows_read, rowsWritten: result.meta.rows_written }
  }
  const pair = async (name: string, query: Query, create: string, drop: string, alternative = query) => {
    const observations: unknown[] = []
    for (const analyzed of [true]) {
      if (analyzed) await d1.prepare('ANALYZE').run()
      const before = await measure(query)
      await d1.prepare(create).run()
      if (analyzed) await d1.prepare('ANALYZE').run()
      const after = await measure(alternative)
      expect(after.result.results, name).toEqual(before.result.results)
      observations.push({ analyzed, before: { rowsRead: before.rowsRead, plan: before.plan }, after: { rowsRead: after.rowsRead, plan: after.plan } })
      await d1.prepare(drop).run()
    }
    experiments.push({ name, sql: query.sql, parameters: query.params.length, observations })
  }
  async function put<T extends SQLiteTable>(table: T, rows: SQLiteInsertValue<T>[]) {
    const statements = insertPieces(table, rows).map(piece => db.insert(table).values(piece))
    for (const piece of chunk(statements, 50)) {
      const [first, ...rest] = piece
      if (first) await db.batch([first, ...rest])
    }
  }
  try {
    for (const file of migrationFiles()) {
      const source = readFileSync(fileURLToPath(new URL(`../db/migrations/sqlite/${file}`, import.meta.url)), 'utf8')
      for (const statement of source.split('--> statement-breakpoint')) if (statement.trim()) await d1.prepare(statement).run()
    }
    // Reproduce Q1's pre-improvement baseline inside this disposable historical probe only.
    // Normal migration-backed tests retain the shipped index (customer-d1-performance.test.ts).
    await d1.prepare('DROP INDEX IF EXISTS orders_tenant_customer_status_due_idx').run()
    await insertBranch(db, { id: 'audit-a', tenantId: 'audit-a', name: 'A', timezone: 'Asia/Phnom_Penh' })
    await insertBranch(db, { id: 'audit-b', tenantId: 'audit-b', name: 'B', timezone: 'Asia/Phnom_Penh' })
    await put(organization, Array.from({ length: 248 }, (_, i) => ({ id: `cafe-${i}`, name: `Cafe ${i}`, slug: `cafe-${i}`, status: 'active', createdAt: old })))
    await put(user, Array.from({ length: 2000 }, (_, i) => ({ id: `person-${i}`, name: `Person ${i}`, email: `person-${i}@example.test`, isAnonymous: false, createdAt: new Date(old.getTime() + i) })))
    await put(member, Array.from({ length: 2000 }, (_, i) => ({ id: `member-${i}`, organizationId: 'audit-a', userId: `person-${i}`, role: i === 0 ? 'owner' : 'member', createdAt: old })))
    const base = { tenantId: 'audit-a', branchId: 'audit-a', customerId: 'person-0', businessDate: '2026-01-01', orderType: 'pickup' as const, subtotalMinor: 100, totalMinor: 100, placedAt: old, paymentDueAt: old }
    await put(orders, Array.from({ length: 5000 }, (_, i) => ({ ...base, id: `history-a-${i}`, pickupNumber: i + 1, status: 'completed' as const })))
    await put(orders, Array.from({ length: 1000 }, (_, i) => ({ ...base, tenantId: 'audit-b', branchId: 'audit-b', id: `history-b-${i}`, pickupNumber: i + 1, status: 'completed' as const })))
    await put(orders, Array.from({ length: 1999 }, (_, i) => ({ ...base, id: `pending-${i}`, customerId: `person-${i + 1}`, businessDate: '2026-10-27', pickupNumber: i + 10, status: 'awaiting_payment' as const, placedAt: now, paymentDueAt: new Date(now.getTime() + 60_000) })))
    await put(orders, (['awaiting_payment', 'preparing', 'ready'] as const).map((status, i) => ({ ...base, id: `active-${i}`, businessDate: '2026-10-27', pickupNumber: i + 1, status, placedAt: new Date(old.getTime() - 100), paymentDueAt: new Date(now.getTime() + 60_000) })))
    await put(outboxMessages, Array.from({ length: 4000 }, (_, i) => ({ id: `sent-mail-${i}`, kind: i % 2 ? 'identity.reset-password' : 'identity.verify-email', payload: {}, status: 'sent' as const, createdAt: old, sentAt: old })))
    await db.insert(menuCategories).values({ id: 'audit-category', tenantId: 'audit-a', name: 'Menu' })
    await put(menuItems, Array.from({ length: 500 }, (_, i) => ({ id: `item-${i}`, tenantId: 'audit-a', categoryId: 'audit-category', name: `Item ${i}`, status: 'active' as const, sortOrder: i })))
    await put(menuItemVariations, Array.from({ length: 1500 }, (_, i) => ({ id: `variation-${i}`, tenantId: 'audit-a', itemId: `item-${Math.floor(i / 3)}`, combinationKey: String(i % 3), priceMinor: 100 + i % 3, status: 'active' as const })))
    evidence.fixture = { cafes: 250, users: 2000, memberships: 2000, finishedOrdersA: 5000, finishedOrdersB: 1000, otherCustomerUnpaid: 1999, ownActive: 3, sentMailMetadata: 4000, menuItems: 500, variations: 1500 }

    const membership = await capture(() => findTenantRole(db, 'audit-a', 'person-1999'))
    await pair('membership point lookup (candidate may be unnecessary)', membership.queries[0]!, 'CREATE INDEX audit_member_pair ON member(organization_id, user_id)', 'DROP INDEX audit_member_pair')

    const current = await capture(() => findCustomerOrdersInProgress(db, 'audit-a', 'person-0', 50))
    const bound = current.queries[0]!
    const index = bound.params.indexOf('awaiting_payment')
    expect(index).toBeGreaterThanOrEqual(0)
    const literal: Query = { sql: bound.sql.replace('"orders"."status" in (?, ?, ?)', '"orders"."status" in (\'awaiting_payment\', \'preparing\', \'ready\')'), params: [...bound.params.slice(0, index), ...bound.params.slice(index + 3)] }
    expect(literal.sql).not.toBe(bound.sql)
    await pair('customer active orders with ordinary unpaid index', bound, 'CREATE INDEX audit_customer_unpaid ON orders(tenant_id, customer_id, status, payment_due_at)', 'DROP INDEX audit_customer_unpaid')
    await pair('customer active orders', bound, 'CREATE INDEX audit_customer_active ON orders(tenant_id, customer_id, placed_at, id) WHERE status in (\'awaiting_payment\', \'preparing\', \'ready\')', 'DROP INDEX audit_customer_active', literal)
    const guard = requireUnpaidAtMost(db, 'audit-a', 'person-0', now, 2) as unknown as { toSQL: () => Query }
    await pair('unpaid-order guard', guard.toSQL(), 'CREATE INDEX audit_customer_unpaid ON orders(tenant_id, customer_id, status, payment_due_at)', 'DROP INDEX audit_customer_unpaid')

    await capture(() => redactExpiredMail(db, now, 500))
    const redaction = seen[0]!
    await pair('expired mail scrub on already-redacted history', redaction, 'CREATE INDEX audit_unredacted_mail ON outbox_messages(kind, created_at, id) WHERE payload <> \'{}\'', 'DROP INDEX audit_unredacted_mail')

    const activity = await capture(() => orderActivity(db, ['audit-a', 'audit-b'], now))
    const recentSince = now
    // Fully qualified SQL is a prototype only; production integration must preserve D1 result aliases.
    const candidate: Query = {
      sql: 'select cafe.id as tenant_id, (select count(*) from orders o where o.tenant_id = cafe.id and o.placed_at >= ?) as recent, (select o.placed_at from orders o where o.tenant_id = cafe.id order by o.placed_at desc limit 1) as last_placed_at from organization cafe where cafe.id in (?, ?) order by cafe.id',
      params: [recentSince.getTime(), 'audit-a', 'audit-b'],
    }
    const activityBefore = await measure(activity.queries[0]!)
    const activityAfter = await measure(candidate)
    expect(activityAfter.result.results.map(row => ({ tenantId: row.tenant_id, recent: Number(row.recent), lastPlacedAt: row.last_placed_at === null ? null : new Date(Number(row.last_placed_at)) }))).toEqual(activity.value)
    experiments.push({ name: 'platform cafe recent count and last-order lookup', before: { rowsRead: activityBefore.rowsRead, plan: activityBefore.plan }, after: { rowsRead: activityAfter.rowsRead, plan: activityAfter.plan }, note: 'same existing tenant/placed index; no new index' })

    const allCafes = await capture(() => listActiveTenants(db))
    const activeOne = db.select({ id: organization.id, slug: organization.slug, name: organization.name }).from(organization).where(and(eq(organization.id, 'audit-a'), activeCafe))
    expect(await activeOne).toEqual((allCafes.value as { id: string }[]).filter(row => row.id === 'audit-a'))
    const cafesBefore = await measure(allCafes.queries[0]!)
    const cafesAfter = await measure(activeOne.toSQL())
    experiments.push({ name: 'known cafe in customer ready messages', before: { rowsRead: cafesBefore.rowsRead, rowsReturned: cafesBefore.result.results.length, plan: cafesBefore.plan }, after: { rowsRead: cafesAfter.rowsRead, rowsReturned: cafesAfter.result.results.length, plan: cafesAfter.plan } })

    const accounts = await capture(() => listAccounts(db, { page: 1, pageSize: 20 }))
    await pair('platform accounts first page', accounts.queries[0]!, 'CREATE INDEX audit_account_created ON user(created_at, id)', 'DROP INDEX audit_account_created')
    experiments.push({ name: 'platform accounts exact count', ...(await measure(accounts.queries[1]!)), result: undefined })

    const actor = { tenantId: 'audit-a', userId: 'person-0', role: 'customer' as const }
    for (const [name, action] of [
      ['customer active bar uses full order list', () => listMyOrders(db, actor, { page: 1, pageSize: 20 })],
      ['customer single order tracking', () => getOrder(db, actor, 'active-1')],
      ['report summary', () => reportSummary(db, 'audit-a', { branchId: 'audit-a', from: '2026-10-27', to: '2026-10-27' }, now)],
    ] as const) {
      const collected = await capture(action)
      const distinctBatchCalls = collected.batchCalls
      const statementResults = await Promise.all(collected.queries.map(query => measure(query)))
      const raw = await d1.batch(collected.queries.map(query => d1.prepare(query.sql).bind(...query.params)))
      expect(raw.map(row => row.results)).toEqual(statementResults.map(row => row.result.results))
      if (name === 'report summary') {
        const counts = collected.queries.at(-1)!
        const where = counts.sql.indexOf(' where ')
        const group = counts.sql.indexOf(' group by ')
        const replacement: Query = {
          sql: counts.sql.slice(0, where) + ` where "orders"."tenant_id" = ? and "orders"."branch_id" = ? and "orders"."status" in ('awaiting_payment', 'preparing', 'ready') and ("orders"."status" <> ? or "orders"."payment_due_at" > ?)` + counts.sql.slice(group),
          params: ['audit-a', 'audit-a', 'awaiting_payment', now.getTime()],
        }
        const improved = await measure(replacement)
        expect(improved.result.results).toEqual(statementResults.at(-1)!.result.results)
        experiments.push({ name: 'report live counts reuse merged active queue index', before: { rowsRead: statementResults.at(-1)!.rowsRead, plan: statementResults.at(-1)!.plan }, after: { rowsRead: improved.rowsRead, plan: improved.plan } })
      }
      experiments.push({ name, sqlStatements: collected.queries.length, batchCalls: distinctBatchCalls, databaseCalls: collected.calls, rowsReadByStatement: statementResults.map(row => row.rowsRead), sql: collected.queries.map(query => query.sql), note: 'raw batch equality in static fixture; context/dependency and service mapping still need implementation tests' })
    }
    const items = await capture(() => listItems(db, 'audit-a', { page: 1, pageSize: 20, status: 'active' }))
    const itemMeasures = await Promise.all(items.queries.map(query => measure(query)))
    experiments.push({ name: 'admin item page', statements: itemMeasures.map(row => ({ rowsRead: row.rowsRead, plan: row.plan })), rowsReturned: (items.value as { rows: unknown[] }).rows.length })
    const pageIds = (items.value as { rows: { id: string }[] }).rows.map(row => row.id)
    const pageSql = items.queries[0]!
    const marker = '"menu_item_variations"."tenant_id" = ?'
    const position = pageSql.sql.indexOf(marker) + marker.length
    expect(position).toBeGreaterThan(marker.length)
    const parameter = pageSql.sql.slice(0, position).split('?').length - 1
    const narrowed: Query = {
      sql: pageSql.sql.slice(0, position) + ' and "menu_item_variations"."item_id" in (select value from json_each(?))' + pageSql.sql.slice(position),
      params: [...pageSql.params.slice(0, parameter), JSON.stringify(pageIds), ...pageSql.params.slice(parameter)],
    }
    const narrowMeasure = await measure(narrowed)
    expect(narrowMeasure.result.results).toEqual(itemMeasures[0]!.result.results)
    experiments.push({ name: 'admin price aggregate restricted to already-selected page ids', before: { rowsRead: itemMeasures[0]!.rowsRead, plan: itemMeasures[0]!.plan }, after: { rowsRead: narrowMeasure.rowsRead, plan: narrowMeasure.plan }, note: 'prototype excludes cost of obtaining page ids; implementation needs one-statement page CTE or a measured extra read, with unchanged filters and count' })
    const catalog = await capture(() => catalogRows(db, 'audit-a', ['item-0', 'item-1']))
    const catalogMeasures = await Promise.all(catalog.queries.map(query => measure(query)))
    experiments.push({ name: 'two-item checkout catalog', batchCalls: catalog.batchCalls, statements: catalogMeasures.map(row => ({ rowsRead: row.rowsRead, rowsReturned: row.result.results.length, plan: row.plan })) })
    for (let i = 1; i < 10; i++) await insertBranch(db, { id: `audit-a-${i}`, tenantId: 'audit-a', name: `A ${i}`, timezone: 'Asia/Phnom_Penh' })
    const publicBranches = await capture(() => listPublicBranches(db, 'audit-a', now))
    expect(publicBranches.value).toHaveLength(10)
    experiments.push({ name: 'public branch selector with ten active branches', branches: 10, databaseCalls: publicBranches.calls, sqlStatements: publicBranches.queries.length, note: 'current 1 + 2N reads; proposed bulk branch/hour read requires public mapper tests' })
    const mediaBase = { tenantId: 'audit-a', mimeType: 'image/webp', byteSize: 1, sha256: '0'.repeat(64), createdAt: old, stateChangedAt: old }
    await put(mediaAssets, Array.from({ length: 500 }, (_, i) => ({ ...mediaBase, id: `root-${i}`, objectKey: `audit/root-${i}.webp`, state: 'attached' as const })))
    await put(mediaAssets, Array.from({ length: 1500 }, (_, i) => ({ ...mediaBase, id: `variant-${i}`, objectKey: `audit/variant-${i}.webp`, parentId: `root-${Math.floor(i / 3)}`, variant: (['card', 'detail', 'detailSmall'] as const)[i % 3], state: 'temporary' as const })))
    await db.insert(mediaAssets).values({ ...mediaBase, id: 'expired-root', objectKey: 'audit/expired.webp' })
    const media = await capture(() => dueExpiredTemporary(db, now, 100))
    expect(media.value).toMatchObject([{ id: 'expired-root' }])
    await pair('photo cleanup partial root index candidate not selected', media.queries[0]!, 'CREATE INDEX audit_media_roots ON media_assets(state, state_changed_at, id) WHERE parent_id IS NULL', 'DROP INDEX audit_media_roots')
    await pair('temporary photo source cleanup compound eligibility index', media.queries[0]!, 'CREATE INDEX audit_media_roots ON media_assets(state, parent_id, state_changed_at, id)', 'DROP INDEX audit_media_roots')
    evidence.mediaFixture = { attachedSources: 500, temporaryStateVariants: 1500, expiredTemporarySources: 1, objectStoreOperations: 0 }
    evidence.internalTables = (await d1.prepare('select name from sqlite_schema where type = \'table\' and name like \'sqlite_%\' order by name').all()).results
    evidence.schema = (await d1.prepare('select type, count(*) as n from sqlite_schema where type in (\'table\', \'index\') group by type').all()).results
    const output = fileURLToPath(new URL('../../docs/reviews/query-audit-evidence-2026-10-27.json', import.meta.url))
    writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n')
    process.stderr.write(`Query audit recorded ${experiments.length} experiments in ${output}\n`)
  }
  finally {
    await proxy.dispose()
  }
})
