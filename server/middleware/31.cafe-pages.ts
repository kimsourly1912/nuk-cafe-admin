import { tenantBySlug } from '#server/features/identity'
import { currentSlugFor } from '#server/features/tenants'
import { movedCafeTarget } from '#server/utils/old-addresses'

/**
 * A cafe's pages (`/c/<slug>/…`, D141) answer only for a cafe that exists and isn't paused: an
 * unknown address is the 404 page, a paused cafe 403 (their own pages come in T2). Checked on the
 * page request itself, so a server-rendered menu never renders an empty shell for an address that
 * names no cafe. An address a cafe had before redirects to its current one (D142). The API checks
 * its own (`requireTenant`).
 */
export default defineEventHandler(async (event) => {
  const slug = /^\/c\/([^/?#]+)/.exec(event.path)?.[1]
  if (!slug) return
  const db = useDb()
  try {
    await tenantBySlug(db, decodeURIComponent(slug))
  }
  catch (error) {
    const moved = isError(error) && error.statusCode === 404 ? await currentSlugFor(db, decodeURIComponent(slug)) : undefined
    if (!moved) throw error
    // Temporary: the address could move again, or come back to this cafe.
    return sendRedirect(event, movedCafeTarget(event.path, moved), 302)
  }
})
