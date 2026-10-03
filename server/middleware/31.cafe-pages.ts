import { tenantBySlug } from '#server/features/identity'
import { currentSlugFor } from '#server/features/tenants'
import { CAFE_NOT_FOUND } from '#shared/contracts/cafe'
import { movedCafeTarget } from '#server/utils/old-addresses'

/**
 * A cafe's pages (`/c/<slug>/…`, D141) answer only for a cafe that exists and isn't paused: an
 * unknown address is the "Cafe not found" page, a paused cafe the "Ordering is paused" page (D143).
 * Checked on the page request itself, so a server-rendered menu never renders an empty shell for an
 * address that names no cafe. An address a cafe had before redirects to its current one (D142).
 * The API checks its own (`requireTenant`).
 */
export default defineEventHandler(async (event) => {
  const slug = /^\/c\/([^/?#]+)/.exec(event.path)?.[1]
  if (!slug) return
  const db = useDb()
  try {
    await tenantBySlug(db, decodeURIComponent(slug))
  }
  catch (error) {
    const notFound = isError(error) && error.statusCode === 404
    const moved = notFound ? await currentSlugFor(db, decodeURIComponent(slug)) : undefined
    // The error page tells "no cafe here" from a missing page by this code (D143); a paused cafe's
    // 403 already carries TENANT_SUSPENDED.
    if (!moved && notFound) throw createError({ statusCode: 404, statusMessage: 'Cafe not found', data: { code: CAFE_NOT_FOUND } })
    if (!moved) throw error
    // Temporary: the address could move again, or come back to this cafe.
    return sendRedirect(event, movedCafeTarget(event.path, moved), 302)
  }
})
