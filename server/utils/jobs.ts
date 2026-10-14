import type { Db } from '#server/utils/batch'
import { readJobCursor, saveJobCursor } from '#server/features/platform'
import { activeTenantPage, currentTenant } from '#server/features/identity'
import { queueJobFailureAlert } from '#server/features/notifications'
import { log } from '#server/utils/log'

/**
 * Tells the chats that get server errors that a scheduled job failed (D150). Jobs belong to no cafe,
 * so like a server error outside a cafe's address (D119), it goes to the default cafe's chats
 * (`currentTenant`) until the platform has an alert channel of its own (Q24). Never throws.
 */
export async function alertJobFailure(job: string, detail?: string) {
  try {
    const db = useDb()
    const tenant = await currentTenant(db).catch(() => null)
    if (tenant) await queueJobFailureAlert(db, tenant.id, { job, detail })
  }
  catch (failure) {
    log('warn', 'Could not queue the job failure alert', { job, error: failure instanceof Error ? failure.message : String(failure) })
  }
}

/**
 * Runs a scheduled job's work (D150): a failure is logged with its stack, alerted on Telegram (at
 * most once per job every 15 minutes) and thrown again, so the job still reports it failed. Before,
 * a failing job was only in Workers Logs, where nobody looks.
 */
export async function runJob<T>(job: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  }
  catch (error) {
    log('error', 'Scheduled job failed', { job, error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined })
    await alertJobFailure(job)
    throw error
  }
}

/** Continue other cafes after a failure; advance a bounded, durable page and retry on the next cycle. */
export async function runTenantPage(db: Db, job: string, work: (tenant: { id: string, slug: string, name: string }) => Promise<unknown>, limit = 25) {
  const cursor = await readJobCursor(db, job)
  const tenants = await activeTenantPage(db, cursor, limit)
  const failures: string[] = []
  for (const tenant of tenants) {
    try {
      await work(tenant)
    }
    catch (error) {
      failures.push(tenant.id)
      log('error', 'Scheduled tenant work failed', { job, tenantId: tenant.id, error: error instanceof Error ? error.message : String(error) })
    }
  }
  await saveJobCursor(db, job, tenants.length === limit ? tenants.at(-1)!.id : null)
  return { processed: tenants.length, failures }
}
