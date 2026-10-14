import { maintainOutbox } from '#server/features/platform'

/** Hourly: scrub expired account links and apply explicitly configured sent-metadata retention. */
export default defineTask({
  meta: { name: 'platform:maintain-outbox', description: 'Redact expired account links and prune sent outbox metadata' },
  async run() {
    return runJob('platform:maintain-outbox', async () => {
      const report = await maintainOutbox(useDb(), { sentRetentionDays: Number(useRuntimeConfig().maintenance.outboxRetentionDays) })
      if (report.redacted || report.removed) log('info', 'Outbox maintained', report)
      return { result: report }
    })
  },
})
