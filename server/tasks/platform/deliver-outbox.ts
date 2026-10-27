import { deliverOutbox } from '#server/features/platform'

/**
 * Every minute (nuxt.config.ts → nitro.scheduledTasks; docs/server/operations.md → Scheduled jobs).
 * Order events are usually sent by their own request already (`sendOrderEventsNow`, D150); this run
 * sends the rest (account emails) and retries whatever failed. A message given up on is logged as an
 * error; the run failing is recorded for System health (`runJob`, D150, D221).
 */
export default defineTask({
  meta: { name: 'platform:deliver-outbox', description: 'Deliver pending outbox messages, with retries' },
  async run() {
    return runJob('platform:deliver-outbox', async () => {
      const report = await deliverOutbox(useDb(), outboxHandlers())
      for (const failure of report.failures) {
        log(failure.final ? 'error' : 'warn', failure.final ? 'Outbox message failed for good' : 'Outbox message will be retried', failure)
      }
      if (report.sent || report.failures.length) log('info', 'Outbox delivered', { sent: report.sent, retried: report.retried, failed: report.failed, skipped: report.skipped })
      return { result: { sent: report.sent, retried: report.retried, failed: report.failed, skipped: report.skipped } }
    })
  },
})
