import { getCafeProfile } from '#server/features/tenants'

/**
 * A cafe's name and logo by its address (D143), for its pages: public, and outside the cafe's own
 * API so the account pages (no cafe in their address) and a paused cafe's page can read it too.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  return getCafeProfile(useDb(), decodeURIComponent(slug))
})
