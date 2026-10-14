import { purgeDeliveries, purgeOrderReadyAlerts } from '#server/features/notifications'
import { drainMaintenance } from '#server/utils/maintenance'

/**
 * Daily (nuxt.config.ts → nitro.scheduledTasks): the delivery history is kept 90 days (D113); the
 * customers' "message me when it's ready" requests 2 days (D157).
 */
export default defineTask({
  meta: { name: 'notifications:purge-deliveries', description: 'Remove Telegram deliveries older than 90 days' },
  async run() {
    return runJob('notifications:purge-deliveries', async () => {
      const db = useDb()
      const now = new Date()
      // Reserve work for each history class so one backlog cannot starve the other.
      const removed = await drainMaintenance(limit => purgeDeliveries(db, now, limit), { budgetMs: 2500 })
      if (removed) log('info', 'Old Telegram deliveries removed', { removed })
      const readyAlerts = await drainMaintenance(limit => purgeOrderReadyAlerts(db, now, limit), { budgetMs: 2500 })
      return { result: { removed, readyAlerts } }
    })
  },
})
