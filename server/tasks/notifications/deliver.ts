import { currentTenant } from '#server/features/identity'
import { deliverDue, queueBakongTokenReminder, queueClosingSummaries } from '#server/features/notifications'

/**
 * Every minute (nuxt.config.ts → nitro.scheduledTasks; D113): queues the closing summaries that are
 * due and the Bakong token's reminders (10.16, D132), then sends every due delivery (alerts
 * retried, summaries, their CSV). Nothing without a bot.
 */
export default defineTask({
  meta: { name: 'notifications:deliver', description: 'Queue closing summaries and reminders, and send due Telegram messages' },
  async run() {
    const settings = useTelegram()
    if (!settings) return { result: { off: true, queued: 0, sent: 0, retried: 0, failed: 0 } }
    const db = useDb()
    const siteUrl = useRuntimeConfig().public.siteUrl as string | undefined
    // The only tenant until Telegram chats belong to one (T1.4, D134); none in an empty database.
    const tenant = await currentTenant(db).catch(() => null)
    const queued = [
      ...(tenant ? await queueClosingSummaries(db, tenant.id, siteUrl) : []),
      ...await queueBakongTokenReminder(db, bakongStatus().tokenExpiresAt, siteUrl),
    ]
    const report = await deliverDue(db, telegramApi(settings))
    if (queued.length || report.sent || report.retried || report.failed) log('info', 'Telegram deliveries', { queued: queued.length, ...report })
    return { result: { off: false, queued: queued.length, ...report } }
  },
})
