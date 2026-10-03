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
  if (isPlatformPath(route.path)) return 'NUK Platform'
  const name = cafe.name.value
  if (isAdminPath(route.path)) return name ? `${name} Admin` : 'Admin'
  if (isCounterPath(route.path)) return name ? `${name} Counter` : 'Counter'
  return name
})
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
    <OfflineBanner />
  </UApp>
</template>
