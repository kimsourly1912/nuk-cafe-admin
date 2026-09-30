import type { H3Event } from 'h3'
import { getRequestURL } from 'h3'
import { qrConfigFrom } from '#server/features/branches'
import type { QrConfig } from '#server/features/branches'

/**
 * The table QR settings for a request (D91): `NUXT_QR_SECRET`, and the customer site's origin
 * (`NUXT_PUBLIC_SITE_URL`, else this request's). A deployed build without the secret refuses with
 * 500 QR_NOT_CONFIGURED; the dev server uses a local one. Route glue, like `requirePermission`.
 */
export function useTableQr(event: H3Event): QrConfig {
  const config = useRuntimeConfig(event)
  return qrConfigFrom({
    secret: config.qrSecret as string | undefined,
    siteUrl: config.public.siteUrl as string | undefined,
    requestOrigin: getRequestURL(event).origin,
    dev: import.meta.dev,
  })
}
