import { withoutTrailingSlash } from '#shared/utils/address'

/**
 * A page's address with a trailing slash redirects to the one without (D208): `/c/nuk/` → `/c/nuk`,
 * the query kept. Before the old and the cafe addresses (30, 31), so those see one form only.
 * Permanent: the app never links to the slashed form.
 */
export default defineEventHandler((event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') return
  const target = withoutTrailingSlash(event.path)
  if (target) return sendRedirect(event, target, 301)
})
