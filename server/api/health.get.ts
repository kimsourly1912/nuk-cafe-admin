import { operationalHealth } from '#server/utils/health'
import { sql } from 'drizzle-orm'

/**
 * `GET /api/health`: 200 when the Worker can reach its database, 503 when not; no details
 * either way (docs/server/operations.md → Monitoring). The deploy's smoke check calls it.
 */
export default defineEventHandler(async (event) => {
  try {
    const db = useDb()
    await db.run(sql`select 1`)
    const maintenance = useRuntimeConfig(event).maintenance
    if (!await operationalHealth(db, { notificationMaxAgeSeconds: Number(maintenance.notificationMaxAgeSeconds), deliveryMaxAgeSeconds: Number(maintenance.deliveryMaxAgeSeconds) })) {
      throw new Error('Scheduled work has no recent success or delivery work is overdue')
    }
    return { status: 'ok' }
  }
  catch (error) {
    log('error', 'Health check: dependency unavailable', { error: String(error) }, event)
    setResponseStatus(event, 503)
    return { status: 'unavailable' }
  }
})
