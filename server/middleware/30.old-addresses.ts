import { oldAddressTarget } from '#server/utils/old-addresses'

/**
 * Pages from before cafe addresses (D141): `/`, `/admin/…`, `/counter/…`, `/checkout`,
 * `/orders/…` redirect to the default cafe's (`NUXT_PUBLIC_DEFAULT_TENANT`, NUK Cafe), keeping the
 * query, so bookmarks, Telegram messages already sent and printed links keep working. Temporary
 * (302): `/` becomes the platform's own page later.
 */
export default defineEventHandler((event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') return
  const target = oldAddressTarget(event.path, useRuntimeConfig(event).public.defaultTenant)
  if (target) return sendRedirect(event, target, 302)
})
