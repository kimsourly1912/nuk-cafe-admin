import type { Db } from '#server/utils/batch'
import { readJobCursor, recordJobRun, saveJobCursor } from '#server/features/platform'
import { activeTenantPage } from '#server/features/identity'
import { log } from '#server/utils/log'

/**
 * Runs a scheduled job's work (D150): a failure is logged with its stack, recorded for System health
 * and thrown again, so the job still reports it failed. Jobs belong to no cafe, so no cafe's chats
 * hear about them (D220). Until the platform has an alert channel of its own (Q24), the independent
 * health check reports work that stops moving, where its NUXT_MAINTENANCE_* ages are set (D168).
 */
export async function runJob<T>(job: string, work: () => Promise<T>): Promise<T> {
  try {
    const result = await work()
    await noteJobRun(job, 'success')
    return result
  }
  catch (error) {
    log('error', 'Scheduled job failed', { job, error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined })
    await noteJobRun(job, 'failure')
    throw error
  }
}

/** The run's outcome for System health (P4, D192). Never fails the job: a lost record is logged. */
async function noteJobRun(job: string, outcome: 'success' | 'failure') {
  try {
    await recordJobRun(useDb(), job, outcome, new Date())
  }
  catch (failure) {
    log('warn', 'Could not record the job run', { job, outcome, error: failure instanceof Error ? failure.message : String(failure) })
  }
}

/** Continue other cafes after a failure; advance a bounded, durable page and retry on the next cycle. */
export async function runTenantPage(db: Db, job: string, work: (tenant: { id: string, slug: string, name: string }) => Promise<unknown>, limit = 25) {
  const cursor = await readJobCursor(db, job)
  let tenants = await activeTenantPage(db, cursor, limit)
  // Reaching the end of an exact-size page is not successful generation. Wrap and do real work;
  // only an empty first page proves that there are no active cafes to process.
  if (!tenants.length && cursor !== null) tenants = await activeTenantPage(db, null, limit)
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
  await saveJobCursor(db, job, tenants.length === limit ? tenants.at(-1)!.id : null, { processed: tenants.length, failures: failures.length })
  return { processed: tenants.length, failures }
}
