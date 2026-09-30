import { expireIdempotencyKeys } from '#server/features/platform'

/** Daily (nuxt.config.ts → nitro.scheduledTasks): removes idempotency keys past their 24 hours. */
export default defineTask({
  meta: { name: 'platform:expire-idempotency-keys', description: 'Remove expired idempotency keys' },
  async run() {
    const removed = await expireIdempotencyKeys(useDb())
    if (removed) log('info', 'Expired idempotency keys removed', { removed })
    return { result: { removed } }
  },
})
