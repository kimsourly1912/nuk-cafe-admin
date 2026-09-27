import { accountMailHandlers, consoleSender, resendSender } from '~~/server/features/identity'
import type { MailSender } from '~~/server/features/identity'
import { deliverOutbox } from '~~/server/features/platform'
import type { OutboxHandler } from '~~/server/features/platform'

/**
 * Resend when a key is set. Without one, the dev server prints mail to the console; anything else
 * throws, so the messages stay queued (and are logged as failing) rather than put one-time links
 * into production logs.
 */
function mailSender(): MailSender {
  const { mail } = useRuntimeConfig()
  if (mail.resendApiKey) {
    if (!mail.from) throw new Error('Set NUXT_MAIL_FROM ("NUK Cafe <no-reply@…>") to send mail.')
    return resendSender({ apiKey: mail.resendApiKey, from: mail.from })
  }
  if (import.meta.dev) return consoleSender()
  throw new Error('Set NUXT_MAIL_RESEND_API_KEY to send mail.')
}

/**
 * One handler per outbox message kind, from the feature that owns it. A message whose kind has no
 * handler is retried, then marked `failed`, so a missing handler shows up in the logs instead of
 * losing messages silently.
 */
function handlers(): Record<string, OutboxHandler> {
  const send: MailSender = (message, key) => mailSender()(message, key)
  return {
    ...accountMailHandlers(send),
  }
}

/** Every minute (nuxt.config.ts → nitro.scheduledTasks; docs/server/operations.md → Scheduled jobs). */
export default defineTask({
  meta: { name: 'platform:deliver-outbox', description: 'Deliver pending outbox messages, with retries' },
  async run() {
    const report = await deliverOutbox(useDb(), handlers())
    for (const failure of report.failures) {
      log(failure.final ? 'error' : 'warn', failure.final ? 'Outbox message failed for good' : 'Outbox message will be retried', failure)
    }
    if (report.sent || report.failures.length) log('info', 'Outbox delivered', { sent: report.sent, retried: report.retried, failed: report.failed, skipped: report.skipped })
    return { result: { sent: report.sent, retried: report.retried, failed: report.failed, skipped: report.skipped } }
  },
})
