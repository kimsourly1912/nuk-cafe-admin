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
// A paused cafe's profile still answers, so its page names it. No cafe in the address: none (D221).
const cafe = useCafe(slug && !cafeNotFound.value ? slug : null)

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
// the address. The platform's pages have no cafe: they go to the platform's page, never a guessed
// cafe's (D221).
const inAdmin = isAdminPath(route.path)
const inCounter = isCounterPath(route.path)
const homePage = '/'
const home = !slug
  ? { label: 'Go to home', path: homePage }
  : inAdmin ? { label: 'Back to dashboard', path: tenantUrl(slug, '/admin') } : { label: 'Back to the menu', path: tenantUrl(slug, '/') }

const view = computed(() => {
  if (cafeNotFound.value) {
    return { icon: 'i-lucide-store', title: 'Cafe not found', heading: 'This cafe doesn\'t exist', description: 'We couldn\'t find a cafe at this address. Check the link or scan the cafe\'s QR code again.' }
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
// No way back into a cafe that isn't there, or that is paused: those leave for the platform's page.
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
    <div class="flex min-h-dvh items-center justify-center p-4 bg-muted">
      <div
        class="grid w-full max-w-5xl items-center gap-8"
        :class="{ 'lg:grid-cols-2': cafeNotFound }"
      >
        <section class="relative flex w-fit mx-auto">
          <div class="absolute top-0 right-0">
            <UColorModeButton />
          </div>
          <UIcon
            v-if="cafeNotFound"
            name="i-app-cafe-shop"
            class="size-64 lg:size-96"
          />
        </section>
        <div
          class="flex flex-col gap-4"
          :class="cafeNotFound ? 'items-center text-center lg:items-start lg:text-left' : 'items-center text-center'"
        >
          <UBadge
            v-if="cafeNotFound"
            :label="view.title"
            color="primary"
            variant="subtle"
          />
          <CafeLogo
            v-else-if="paused && cafe.logoUrl.value"
            :url="cafe.logoUrl.value"
            class="size-12"
          />
          <UIcon
            v-else
            :name="view.icon"
            class="size-10 text-muted"
          />
          <h1 class="text-xl font-semibold text-highlighted">
            {{ view.heading ?? view.title }}
          </h1>
          <p class="max-w-md text-muted">
            {{ view.description }}
          </p>
          <UAlert
            v-if="cafeNotFound"
            icon="i-lucide-info"
            color="warning"
            variant="subtle"
            title="Are you at the cafe?"
            description="Please make sure you're using the correct QR code or link from this cafe."
            class="text-left max-lg:max-w-lg"
          />
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
          <UButton
            v-else
            label="Go to home"
            icon="i-lucide-house"
            @click="clearError({ redirect: homePage })"
          />
        </div>
      </div>
    </div>
  </UApp>
</template>
