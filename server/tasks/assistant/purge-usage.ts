import { purgeAssistantUsage } from '~~/server/features/assistant'

/** Daily (nuxt.config.ts → nitro.scheduledTasks): removes assistant usage rows past their 90 days (D108). */
export default defineTask({
  meta: { name: 'assistant:purge-usage', description: 'Remove assistant usage older than 90 days' },
  async run() {
    const removed = await purgeAssistantUsage(useDb())
    if (removed) log('info', 'Old assistant usage removed', { removed })
    return { result: { removed } }
  },
})
