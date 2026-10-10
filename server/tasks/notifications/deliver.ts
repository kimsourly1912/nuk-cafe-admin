import { activeTenants } from '#server/features/identity'
import { deliverDue, queueBakongTokenReminder, queueClosingSummaries } from '#server/features/notifications'
import { bakongTokenExpiries } from '#server/features/orders'

/**
 * Every minute (nuxt.config.ts → nitro.scheduledTasks; D113): queues every tenant's closing
 * summaries that are due (D138) and each cafe's Bakong token reminders (10.16 D132, per cafe since
 * D148), then sends every due delivery (alerts retried, summaries, their CSV). Nothing without a bot.
 */
export default defineTask({
  meta: { name: 'notifications:deliver', description: 'Queue closing summaries and reminders, and send due Telegram messages' },
  async run() {
    return runJob('notifications:deliver', async () => {
      const settings = useTelegram()
      if (!settings) return { result: { off: true, queued: 0, sent: 0, retried: 0, failed: 0 } }
      const db = useDb()
      const queued: string[] = []
      const tenants = await activeTenants(db)
      // Each cafe's buttons open its own pages (`/c/<slug>/…`, D141).
      for (const tenant of tenants) queued.push(...await queueClosingSummaries(db, tenant.id, cafeSiteUrl(tenant.slug)))
      // Each cafe's own token, reminded to its own chats (a paused cafe's waits until it's resumed).
      const expiries = new Map((await bakongTokenExpiries(db)).map(row => [row.tenantId, row.expiresAt]))
      for (const tenant of tenants) {
        const expiresAt = expiries.get(tenant.id)
        if (expiresAt) queued.push(...await queueBakongTokenReminder(db, tenant.id, expiresAt, cafeSiteUrl(tenant.slug)))
      }
      const report = await deliverDue(db, telegramApi(settings))
      if (queued.length || report.sent || report.retried || report.failed) log('info', 'Telegram deliveries', { queued: queued.length, ...report })
      return { result: { off: false, queued: queued.length, ...report } }
    })
  },
})
