import { activeTenants, currentTenant } from '#server/features/identity'
import { deliverDue, queueBakongTokenReminder, queueClosingSummaries } from '#server/features/notifications'

/**
 * Every minute (nuxt.config.ts → nitro.scheduledTasks; D113): queues every tenant's closing
 * summaries that are due (D138) and the Bakong token's reminders (10.16, D132), then sends every
 * due delivery (alerts retried, summaries, their CSV). Nothing without a bot.
 */
export default defineTask({
  meta: { name: 'notifications:deliver', description: 'Queue closing summaries and reminders, and send due Telegram messages' },
  async run() {
    const settings = useTelegram()
    if (!settings) return { result: { off: true, queued: 0, sent: 0, retried: 0, failed: 0 } }
    const db = useDb()
    const queued: string[] = []
    // Each cafe's buttons open its own pages (`/c/<slug>/…`, D141).
    for (const tenant of await activeTenants(db)) queued.push(...await queueClosingSummaries(db, tenant.id, cafeSiteUrl(tenant.slug)))
    // The Bakong token is still one server setting, NUK Cafe's: its reminders go to the first
    // tenant's chats until each cafe has its own token (T2).
    const tokenTenant = await currentTenant(db).catch(() => null)
    if (tokenTenant) queued.push(...await queueBakongTokenReminder(db, tokenTenant.id, bakongStatus().tokenExpiresAt, cafeSiteUrl(tokenTenant.slug)))
    const report = await deliverDue(db, telegramApi(settings))
    if (queued.length || report.sent || report.retried || report.failed) log('info', 'Telegram deliveries', { queued: queued.length, ...report })
    return { result: { off: false, queued: queued.length, ...report } }
  },
})
