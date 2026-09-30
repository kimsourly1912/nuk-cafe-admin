import { deliverDue, queueClosingSummaries } from '~~/server/features/notifications'

/**
 * Every minute (nuxt.config.ts → nitro.scheduledTasks; D113): queues the closing summaries that are
 * due, then sends every due delivery (alerts retried, summaries, their CSV). Nothing without a bot.
 */
export default defineTask({
  meta: { name: 'notifications:deliver', description: 'Queue closing summaries and send due Telegram messages' },
  async run() {
    const settings = useTelegram()
    if (!settings) return { result: { off: true, queued: 0, sent: 0, retried: 0, failed: 0 } }
    const db = useDb()
    const queued = await queueClosingSummaries(db, useRuntimeConfig().public.siteUrl as string | undefined)
    const report = await deliverDue(db, telegramApi(settings))
    if (queued.length || report.sent || report.retried || report.failed) log('info', 'Telegram deliveries', { queued: queued.length, ...report })
    return { result: { off: false, queued: queued.length, ...report } }
  },
})
