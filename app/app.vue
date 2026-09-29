<script setup lang="ts">
import { isAdminPath } from '~/features/auth'
import { isCounterPath } from '~/features/counter'

// Browser tab title from each route file's `definePageMeta({ title })`, so tabs are told apart.
// The admin workspace, the counter (D102) and the customer site (D93) name themselves differently.
const route = useRoute()
const siteName = computed(() => (isAdminPath(route.path) ? 'NUK Cafe Admin' : isCounterPath(route.path) ? 'NUK Cafe Counter' : 'NUK Cafe'))
useHead({
  title: () => route.meta.title,
  titleTemplate: title => (title ? `${title} · ${siteName.value}` : siteName.value),
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <OfflineBanner />
  </UApp>
</template>
