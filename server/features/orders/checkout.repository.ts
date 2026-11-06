import { sql } from 'drizzle-orm'
import type { Db, Statement } from '#server/utils/batch'
import { requireCount } from '#server/utils/batch'

const databaseNow = sql<number>`cast(unixepoch('subsecond') * 1000 as integer)`

/** Database time avoids extending a deadline with Worker/D1 clock skew. */
export async function checkoutClock(db: Db, at?: Date): Promise<{ at: Date, guard: Statement }> {
  const [row] = await db.select({ now: databaseNow }).from(sql`(select 1)`)
  const started = row!.now
  const time = at ?? new Date(started)
  // Hours, last orders, availability windows and promotion dates change on minute boundaries.
  // An explicit test time uses the same elapsed database clock with a shifted logical origin.
  const remaining = 60_000 - (time.getTime() % 60_000)
  return {
    at: time,
    guard: requireCount(db, sql`select case when ${databaseNow} < ${started + remaining} then 1 else 0 end`, 1),
  }
}

/** A database clock with an optional logical origin for deterministic service tests. */
export async function paymentClock(db: Db, at?: Date) {
  const read = async () => {
    const [row] = await db.select({ now: databaseNow }).from(sql`(select 1)`)
    return row!.now
  }
  const started = await read()
  const origin = at?.getTime() ?? started
  return {
    at: new Date(origin),
    now: sql<number>`${databaseNow} - ${started} + ${origin}`,
    readNow: async () => new Date(origin + await read() - started),
  }
}
