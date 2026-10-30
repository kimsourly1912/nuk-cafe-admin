/**
 * Scheduled jobs, cron in UTC (docs/server/operations.md → Scheduled jobs). `nuxt.config.ts` gives
 * them to Nitro; the platform console's System health lists every one, also one that never ran
 * (P4, D192).
 */
export const SCHEDULED_TASKS: Record<string, string[]> = {
  '* * * * *': ['platform:deliver-outbox', 'orders:expire-unpaid', 'notifications:deliver', 'marketing:deliver-posts'],
  '15 3 * * *': ['platform:expire-idempotency-keys', 'assistant:purge-usage', 'notifications:purge-deliveries', 'identity:clear-idle-guests'],
  '5 * * * *': ['media:purge-temporary', 'platform:maintain-outbox'],
}

/** Each job with its schedule, in the order above. */
export const SCHEDULED_JOBS: { job: string, schedule: string }[] = Object.entries(SCHEDULED_TASKS)
  .flatMap(([schedule, jobs]) => jobs.map(job => ({ job, schedule })))
