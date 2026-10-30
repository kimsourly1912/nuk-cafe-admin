import type { Db } from '#server/utils/batch'
import { chunk } from '#server/utils/batch'
import { maintenanceLimit } from '#server/utils/maintenance'
import type { GuestCursor } from './guests.repository'
import * as repo from './guests.repository'

/** A guest unused this long is emptied (owner, 2026-10-30, D229). */
export const IDLE_GUEST_DAYS = 90

export interface ClearIdleGuestsOptions {
  now?: Date
  /**
   * Of these customers, the ones who placed an order since `since` (orders' `customersOrderingSince`).
   * Passed in by the task: orders already imports identity.
   */
  orderedSince: (customerIds: string[], since: Date) => Promise<Set<string>>
  pageSize?: number
  budgetMs?: number
}

/**
 * The daily cleanup of guests (D229, D236): a guest with no change, no session used and no order
 * placed for 90 days is emptied, never deleted (its orders reference it). Pages through the idle
 * guests by their last change, so guests kept for a recent order never block the rest; stops
 * starting pages at the budget (the next day resumes). Safe to run twice.
 */
export async function clearIdleGuests(db: Db, options: ClearIdleGuestsOptions): Promise<{ emptied: number, kept: number }> {
  const { now = new Date(), orderedSince, budgetMs = 5000 } = options
  const pageSize = maintenanceLimit(options.pageSize)
  const cutoff = new Date(now.getTime() - IDLE_GUEST_DAYS * 24 * 60 * 60 * 1000)
  const started = Date.now()
  let after: GuestCursor | null = null
  let emptied = 0
  let kept = 0
  for (let page = 0; page < 50 && Date.now() - started < budgetMs; page++) {
    const guests = await repo.idleGuests(db, cutoff, after, pageSize)
    if (!guests.length) break
    after = guests.at(-1)!
    const ordering = await orderedSince(guests.map(g => g.id), cutoff)
    const idle = guests.map(g => g.id).filter(id => !ordering.has(id))
    kept += guests.length - idle.length
    for (const ids of chunk(idle)) {
      const [changed] = await db.batch(repo.emptyGuestsStatements(db, ids, cutoff, now)) as [{ id: string }[], ...unknown[]]
      emptied += changed.length
    }
    if (guests.length < pageSize) break
  }
  return { emptied, kept }
}
