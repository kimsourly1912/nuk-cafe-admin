import { purgeDeliveries, purgeOrderReadyAlerts } from '#server/features/notifications'

/**
 * Daily (nuxt.config.ts → nitro.scheduledTasks): the delivery history is kept 90 days (D113); the
 * customers' "message me when it's ready" requests 2 days (D157).
 */
export default defineTask({
  meta: { name: 'notifications:purge-deliveries', description: 'Remove Telegram deliveries older than 90 days' },
  async run() {
    return runJob('notifications:purge-deliveries', async () => {
      const removed = await purgeDeliveries(useDb())
      if (removed) log('info', 'Old Telegram deliveries removed', { removed })
      const readyAlerts = await purgeOrderReadyAlerts(useDb())
      return { result: { removed, readyAlerts } }
    })
  },
})
