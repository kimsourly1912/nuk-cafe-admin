import { purgeDeliveries } from '~~/server/features/notifications'

/** Daily (nuxt.config.ts → nitro.scheduledTasks): the delivery history is kept 90 days (D113). */
export default defineTask({
  meta: { name: 'notifications:purge-deliveries', description: 'Remove Telegram deliveries older than 90 days' },
  async run() {
    const removed = await purgeDeliveries(useDb())
    if (removed) log('info', 'Old Telegram deliveries removed', { removed })
    return { result: { removed } }
  },
})
