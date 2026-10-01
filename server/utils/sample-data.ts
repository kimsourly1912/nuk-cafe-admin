import type { H3Event } from 'h3'
import { sampleDataOff } from '#server/features/sample-data'

/**
 * Route glue for `/api/admin/sample-data/**` (D94): the environment must turn sample data on
 * (`NUXT_PUBLIC_SAMPLE_DATA_ENABLED`, local and staging; never production), else the routes don't
 * exist (404). Then the caller must hold everything loading touches: menu, branch and settings.
 */
export async function requireSampleData(event: H3Event) {
  const { sampleData } = useRuntimeConfig(event).public
  if (!sampleData.enabled) throw sampleDataOff()
  const actor = await requirePermission(event, { menu: ['write', 'publish'], branch: ['update'], settings: ['manage'] })
  return { actor, environment: sampleData.environment || 'Test' }
}
