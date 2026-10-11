import { deliverDuePosts } from '#server/features/marketing'

/**
 * Every minute (nuxt.config.ts → nitro.scheduledTasks; M2a, D164): sends the promotion posts whose
 * time has come, and retries the ones Telegram didn't take. Nothing without a bot.
 */
export default defineTask({
  meta: { name: 'marketing:deliver-posts', description: 'Send scheduled and retried promotion posts to channels' },
  async run() {
    return runJob('marketing:deliver-posts', async () => {
      const settings = useTelegram()
      if (!settings) return { result: { off: true, sent: 0, retried: 0, failed: 0, cancelled: 0 } }
      const report = await deliverDuePosts(useDb(), telegramApi(settings), readStoredObject)
      if (report.sent || report.retried || report.failed || report.cancelled) log('info', 'Promotion posts', { ...report })
      return { result: { off: false, ...report } }
    })
  },
})
