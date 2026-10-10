<script setup lang="ts">
import { isAdminPath } from '~/features/auth'
import { isCounterPath } from '~/features/counter'
import { isPlatformPath } from '~/features/platform'

// Browser tab title from each route file's `definePageMeta({ title })`, so tabs are told apart.
// The admin workspace, the counter (D102) and the customer site (D93) name themselves after the
// cafe of the address (D143); the platform console (D142) after the platform.
const route = useRoute()
const cafe = useCafe()
const siteName = computed(() => {
  // The platform console, and Your cafes, which spans cafes (D144).
  if (isPlatformPath(route.path) || route.path === CAFES_PATH) return 'NUK Platform'
  const name = cafe.name.value
  if (isAdminPath(route.path)) return name ? `${name} Admin` : 'Admin'
  if (isCounterPath(route.path)) return name ? `${name} Counter` : 'Counter'
  return name
})
// The workspaces' tabs stay open all day: they're offered a new build when one is deployed (D149).
// The customer site just loads it on the next page change.
const isWorkspace = computed(() => isAdminPath(route.path) || isCounterPath(route.path) || isPlatformPath(route.path))

// The whole input is a computed: unhead calls a template function only when a title changes, so a
// new one (on a rename, D143) must arrive as a new head input.
useHead(computed(() => {
  const site = siteName.value
  return {
    title: route.meta.title,
    titleTemplate: (title?: string) => (title && site ? `${title} · ${site}` : title || site),
  }
}))
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <!-- Bottom center, stacked: the update notice in the workspaces (D149), the offline notice everywhere. -->
    <div class="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
      <NewVersionBanner v-if="isWorkspace" />
      <OfflineBanner />
    </div>
  </UApp>
</template>
