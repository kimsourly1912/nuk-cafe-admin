<script setup lang="ts">
import { isAdminPath } from '~/features/auth'

// Browser tab title from each route file's `definePageMeta({ title })`, so tabs are told apart.
// The admin workspace and the customer site (D93) name themselves differently.
const route = useRoute()
const siteName = computed(() => (isAdminPath(route.path) ? 'NUK Cafe Admin' : 'NUK Cafe'))
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
