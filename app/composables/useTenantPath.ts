/**
 * The cafe of the page on screen (its address, D141), and addresses inside it:
 * `const tenantPath = useTenantPath()`, then `tenantPath('/admin/products')` → `/c/nuk/admin/products`.
 * Nothing guesses a cafe (D220): on the platform's pages (no cafe in the address) `useTenantSlug`
 * and `tenantPath` throw, so a cafe's screen or link can't quietly act in a cafe nobody opened.
 * Code that also runs on the platform's pages (the app shell, `useCafe`) reads
 * `useOptionalTenantSlug`, which is `null` there.
 */
export function useOptionalTenantSlug(): ComputedRef<string | null> {
  const route = useRoute()
  return computed(() => (typeof route.params.slug === 'string' && route.params.slug) || null)
}

/** The cafe of a cafe's page (`/c/<slug>/…`); throws on a page without one. */
export function useTenantSlug(): ComputedRef<string> {
  const slug = useOptionalTenantSlug()
  return computed(() => {
    if (!slug.value) throw new Error('A cafe\'s screen was shown on a page without a cafe in its address.')
    return slug.value
  })
}

export function useTenantPath(): (path: string) => string {
  const slug = useTenantSlug()
  return (path: string) => tenantUrl(slug.value, path)
}
