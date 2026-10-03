/**
 * A cafe's address on the site (D141), for links the server sends out (Telegram's buttons):
 * `https://<site>/c/<slug>`. `undefined` without a site address (a local machine): the messages then
 * go without buttons.
 */
export function cafeSiteUrl(slug: string): string | undefined {
  const siteUrl = useRuntimeConfig().public.siteUrl as string | undefined
  return siteUrl ? `${siteUrl.replace(/\/+$/, '')}/c/${slug}` : undefined
}
