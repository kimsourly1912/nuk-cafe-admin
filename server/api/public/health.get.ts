import { sql } from 'drizzle-orm'

/**
 * `GET /api/public/health`: 200 when the Worker can reach its database, 503 when not; no details
 * either way (docs/server/operations.md → Monitoring). The deploy's smoke check calls it.
 */
export default defineEventHandler(async (event) => {
  try {
    await useDb().run(sql`select 1`)
    return { status: 'ok' }
  }
  catch (error) {
    log('error', 'Health check: database unreachable', { error: String(error) }, event)
    setResponseStatus(event, 503)
    return { status: 'unavailable' }
  }
})
