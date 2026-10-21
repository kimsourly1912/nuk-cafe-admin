import { tenantById } from '#server/features/identity'
import { deliverDue, deliverOrderReadyDue, queueBakongTokenReminder, queueClosingSummaries } from '#server/features/notifications'
import { bakongTokenExpiryOf } from '#server/features/orders'

/**
 * Every minute (D113): sends due deliveries first, then generates closing summaries (D138) and
 * Bakong reminders (D132/D148) for one durable page of cafes (D168). Nothing without a bot.
 */
export default defineTask({
  meta: { name: 'notifications:deliver', description: 'Queue closing summaries and reminders, and send due Telegram messages' },
  async run() {
    return runJob('notifications:deliver', async () => {
      const settings = useTelegram()
      if (!settings) return { result: { off: true, queued: 0, sent: 0, retried: 0, failed: 0 } }
      const db = useDb()
      // Existing alerts must progress even when a cafe's report generation fails.
      const api = telegramApi(settings)
      const report = await deliverDue(db, api)
      // Customers' ready messages a failed catch-up, a failed retry or a stopped worker left behind.
      const customers = await deliverOrderReadyDue(db, api, async (tenantId) => {
        const tenant = await tenantById(db, tenantId)
        return tenant ? cafeSiteUrl(tenant.slug) : undefined
      })
      const queued: string[] = []
      const page = await runTenantPage(db, 'notifications:generate', async (tenant) => {
        const cafeUrl = cafeSiteUrl(tenant.slug)
        // Independent phases: a closing-summary failure must not suppress token reminders.
        const results = await Promise.allSettled([
          queueClosingSummaries(db, tenant.id, cafeUrl),
          (async () => {
            const expiresAt = await bakongTokenExpiryOf(db, tenant.id)
            return expiresAt ? queueBakongTokenReminder(db, tenant.id, expiresAt, cafeUrl) : []
          })(),
        ])
        for (const result of results) if (result.status === 'fulfilled') queued.push(...result.value)
        const failed = results.find(result => result.status === 'rejected')
        if (failed?.status === 'rejected') throw failed.reason
      })
      if (queued.length || report.sent || report.retried || report.failed || customers.sent || customers.failed) log('info', 'Telegram deliveries', { queued: queued.length, ...report, customerSent: customers.sent, customerFailed: customers.failed })
      if (page.failures.length) throw new Error(`Notification generation failed for ${page.failures.length} cafes; other cafes and due deliveries were processed.`)
      return { result: { off: false, queued: queued.length, ...report, customerSent: customers.sent, customerFailed: customers.failed } }
    })
  },
})
