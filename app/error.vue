<script setup lang="ts">
import type { NuxtError } from '#app'
import { CAFE_NOT_FOUND, TENANT_SUSPENDED } from '#shared/contracts/cafe'
import { isAdminPath } from '~/features/auth'
import { isCounterPath } from '~/features/counter'

/**
 * Fatal errors: unknown routes, or `showError()` / `throw createError({ fatal: true })`. A cafe's
 * address that names no cafe, and a paused cafe, have pages of their own (D143): the server refuses
 * those page requests with `CAFE_NOT_FOUND` or `TENANT_SUSPENDED`.
 */
const props = defineProps<{ error: NuxtError }>()

const route = useRoute()
const slug = splitTenantUrl(route.path)?.slug
// Nuxt hands the server error's `data` over as JSON text after a server render, as an object otherwise.
const code = computed(() => {
  const data = typeof props.error.data === 'string' ? safeParse(props.error.data) : props.error.data
  return data && typeof data === 'object' && 'code' in data ? data.code : undefined
})
const cafeNotFound = computed(() => Boolean(slug) && code.value === CAFE_NOT_FOUND)
const paused = computed(() => Boolean(slug) && code.value === TENANT_SUSPENDED)
// A paused cafe's profile still answers, so its page names it.
const defaultSlug = useTenantSlug().value
const cafe = useCafe(slug && !cafeNotFound.value ? slug : defaultSlug)

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  }
  catch {
    return undefined
  }
}

const isNotFound = computed(() => props.error.statusCode === 404)
// The admin workspace goes back to its dashboard, the customer site to the menu (D93), in the cafe of
// the address (the default cafe's on the platform's pages, D141).
const inAdmin = isAdminPath(route.path)
const inCounter = isCounterPath(route.path)
const tenantPath = useTenantPath()
const home = inAdmin ? { label: 'Back to dashboard', path: tenantPath('/admin') } : { label: 'Back to the menu', path: tenantPath('/') }

const view = computed(() => {
  if (cafeNotFound.value) {
    return { icon: 'i-lucide-store', title: 'Cafe not found', description: 'There\'s no cafe at this address. Check the link, or scan the cafe\'s QR code again.' }
  }
  if (paused.value) {
    const who = cafe.name.value || 'This cafe'
    const description = inAdmin || inCounter
      ? `${who} is paused by the platform team, so its admin and counter are closed. Ask them to resume it.`
      : `${who} isn't taking orders at the moment. Please try again later.`
    return { icon: 'i-lucide-circle-pause', title: inAdmin || inCounter ? 'This cafe is paused' : 'Ordering is paused', description }
  }
  return isNotFound.value
    ? { icon: 'i-lucide-map-pin-off', title: 'Page not found', description: 'The page you are looking for doesn\'t exist.' }
    : { icon: 'i-lucide-triangle-alert', title: 'Something went wrong', description: getErrorMessage(props.error) }
})
// No way back into a cafe that isn't there, or that is paused.
const showHome = computed(() => !cafeNotFound.value && !paused.value)

// Rendered instead of app.vue, so it sets its own tab title.
const siteName = computed(() => {
  if (cafeNotFound.value) return ''
  const name = cafe.name.value
  if (!name) return ''
  return inAdmin ? `${name} Admin` : inCounter ? `${name} Counter` : name
})
useHead({ title: () => (siteName.value ? `${view.value.title} · ${siteName.value}` : view.value.title) })
</script>

<template>
  <UApp>
    <div class="flex min-h-dvh flex-col items-center justify-center gap-4 p-4 text-center">
      <CafeLogo
        v-if="paused && cafe.logoUrl.value"
        :url="cafe.logoUrl.value"
        class="size-12"
      />
      <UIcon
        v-else
        :name="view.icon"
        class="size-10 text-muted"
      />
      <h1 class="text-xl font-semibold">
        {{ view.title }}
      </h1>
      <p class="max-w-md text-muted">
        {{ view.description }}
      </p>
      <UButton
        v-if="showHome"
        :label="home.label"
        icon="i-lucide-arrow-left"
        @click="clearError({ redirect: home.path })"
      />
      <UButton
        v-else-if="paused"
        label="Try again"
        icon="i-lucide-rotate-cw"
        color="neutral"
        variant="outline"
        @click="reloadNuxtApp({ force: true })"
      />
    </div>
  </UApp>
</template>
