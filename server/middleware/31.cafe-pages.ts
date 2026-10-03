import { tenantBySlug } from '#server/features/identity'

/**
 * A cafe's pages (`/c/<slug>/…`, D141) answer only for a cafe that exists and isn't paused: an
 * unknown address is the 404 page, a paused cafe 403 (their own pages come in T2). Checked on the
 * page request itself, so a server-rendered menu never renders an empty shell for an address that
 * names no cafe. The API checks its own (`requireTenant`).
 */
export default defineEventHandler(async (event) => {
  const slug = /^\/c\/([^/?#]+)/.exec(event.path)?.[1]
  if (!slug) return
  await tenantBySlug(useDb(), decodeURIComponent(slug))
})
