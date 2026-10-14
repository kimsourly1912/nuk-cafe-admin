import { isJobCurrent } from '#server/features/platform'
import { sql } from 'drizzle-orm'

/**
 * `GET /api/health`: 200 when the Worker can reach its database, 503 when not; no details
 * either way (docs/server/operations.md → Monitoring). The deploy's smoke check calls it.
 */
export default defineEventHandler(async (event) => {
  try {
    const db = useDb()
    await db.run(sql`select 1`)
    const maxAge = Number(useRuntimeConfig(event).maintenance.notificationMaxAgeSeconds)
    if (maxAge > 0 && !await isJobCurrent(db, 'notifications:generate', maxAge)) {
      throw new Error('Notification scheduler heartbeat is missing or stale')
    }
    return { status: 'ok' }
  }
  catch (error) {
    log('error', 'Health check: dependency unavailable', { error: String(error) }, event)
    setResponseStatus(event, 503)
    return { status: 'unavailable' }
  }
})
