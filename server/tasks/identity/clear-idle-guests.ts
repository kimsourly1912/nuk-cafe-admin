import { clearIdleGuests } from '#server/features/identity'
import { customersOrderingSince } from '#server/features/orders'

/**
 * Daily (nuxt.config.ts → nitro.scheduledTasks): guests unused for 90 days are emptied, their
 * orders kept (D229, D236).
 */
export default defineTask({
  meta: { name: 'identity:clear-idle-guests', description: 'Empty guests unused for 90 days' },
  async run() {
    return runJob('identity:clear-idle-guests', async () => {
      const db = useDb()
      const result = await clearIdleGuests(db, { orderedSince: (ids, since) => customersOrderingSince(db, ids, since) })
      if (result.emptied) log('info', 'Idle guests emptied', result)
      return { result }
    })
  },
})
