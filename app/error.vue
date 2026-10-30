<script setup lang="ts">
import type { NuxtError } from '#app'
import { isAdminPath } from '~/features/auth'
import { isCounterPath } from '~/features/counter'
import { classifyError, errorCopy, ErrorView } from '~/features/errors'

/**
 * Fatal errors: unknown routes, or `showError()` / `throw createError({ fatal: true })`. A cafe's
 * address that names no cafe, and a paused cafe, have pages of their own (D143): the server refuses
 * those page requests with `CAFE_NOT_FOUND` or `TENANT_SUSPENDED`. The pages are the errors
 * feature's; this shell knows the address.
 */
const props = defineProps<{ error: NuxtError }>()

const route = useRoute()
const slug = splitTenantUrl(route.path)?.slug
const kind = computed(() => classifyError(props.error, slug))
// A paused cafe's profile still answers, so its page names it. No cafe in the address: none (D221).
const cafe = useCafe(slug && kind.value !== 'cafe-not-found' ? slug : null)

// The admin workspace goes back to its dashboard, the counter to its home (D240), the customer site to
// the menu (D93), in the cafe of the address. The platform's pages have no cafe: they go to the platform's page, never a guessed
// cafe's (D221).
const inAdmin = isAdminPath(route.path)
const inCounter = isCounterPath(route.path)
const homePage = '/'
const home = !slug
  ? { label: 'Go to home', path: homePage }
  : inAdmin
    ? { label: 'Back to dashboard', path: tenantUrl(slug, '/admin') }
    : inCounter ? { label: 'Back to the counter', path: tenantUrl(slug, '/counter') } : { label: 'Back to the menu', path: tenantUrl(slug, '/') }

const context = computed(() => ({
  workspace: inAdmin || inCounter,
  cafeName: cafe.name.value,
  // Only an error without a page of its own shows its message; the others' errors have no readable one.
  message: kind.value === 'generic' ? getErrorMessage(props.error) : '',
}))

// Rendered instead of app.vue, so it sets its own tab title.
const siteName = computed(() => {
  if (kind.value === 'cafe-not-found') return ''
  const name = cafe.name.value
  if (!name) return ''
  return inAdmin ? `${name} Admin` : inCounter ? `${name} Counter` : name
})
const title = computed(() => errorCopy(kind.value, context.value).title)
useHead({ title: () => (siteName.value ? `${title.value} · ${siteName.value}` : title.value) })
</script>

<template>
  <UApp>
    <div class="flex min-h-dvh items-center justify-center p-4 bg-muted">
      <ErrorView
        :kind="kind"
        :message="context.message"
        :workspace="context.workspace"
        :cafe-name="context.cafeName"
        :logo-url="cafe.logoUrl.value || null"
        :home="home"
      />
    </div>
  </UApp>
</template>
