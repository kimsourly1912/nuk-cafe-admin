import { deliverOutbox } from '~~/server/features/platform'
import type { OutboxHandler } from '~~/server/features/platform'

/**
 * One handler per outbox message kind, from the feature that owns it (e.g. identity's
 * verification email in step 1.6). A message whose kind has no handler is retried, then marked
 * `failed`, so a missing handler shows up in the logs instead of losing messages silently.
 */
const handlers: Record<string, OutboxHandler> = {}

/** Every minute (nuxt.config.ts → nitro.scheduledTasks; docs/server/operations.md → Scheduled jobs). */
export default defineTask({
  meta: { name: 'platform:deliver-outbox', description: 'Deliver pending outbox messages, with retries' },
  async run() {
    const report = await deliverOutbox(useDb(), handlers)
    for (const failure of report.failures) {
      log(failure.final ? 'error' : 'warn', failure.final ? 'Outbox message failed for good' : 'Outbox message will be retried', failure)
    }
    if (report.sent || report.failures.length) log('info', 'Outbox delivered', { sent: report.sent, retried: report.retried, failed: report.failed, skipped: report.skipped })
    return { result: { sent: report.sent, retried: report.retried, failed: report.failed, skipped: report.skipped } }
  },
})
