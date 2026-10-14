import { expireIdempotencyKeys } from '#server/features/platform'

/** Daily (nuxt.config.ts → nitro.scheduledTasks): removes idempotency keys past their 24 hours. */
export default defineTask({
  meta: { name: 'platform:expire-idempotency-keys', description: 'Remove expired idempotency keys' },
  async run() {
    return runJob('platform:expire-idempotency-keys', async () => {
      const db = useDb()
      const started = Date.now()
      let removed = 0
      let page: number
      do {
        page = await expireIdempotencyKeys(db)
        removed += page
      } while (page === 500 && Date.now() - started < 5000)
      if (removed) log('info', 'Expired idempotency keys removed', { removed })
      return { result: { removed } }
    })
  },
})
