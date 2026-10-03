/**
 * The cafe of the page on screen (its address, D141), and addresses inside it:
 * `const tenantPath = useTenantPath()`, then `tenantPath('/admin/products')` → `/c/nuk/admin/products`.
 * On the platform's pages (no cafe in the address) it's NUK Cafe's (`NUXT_PUBLIC_DEFAULT_TENANT`)
 * until a cafe can be chosen (T2).
 */
export function useTenantSlug(): ComputedRef<string> {
  const route = useRoute()
  const fallback = useRuntimeConfig().public.defaultTenant
  return computed(() => (typeof route.params.slug === 'string' && route.params.slug) || fallback)
}

export function useTenantPath(): (path: string) => string {
  const slug = useTenantSlug()
  return (path: string) => tenantUrl(slug.value, path)
}
