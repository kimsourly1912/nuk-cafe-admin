<script setup lang="ts">
// Browser tab title from each route file's `definePageMeta({ title })`, so tabs are told apart.
const route = useRoute()
useHead({
  title: () => route.meta.title,
  titleTemplate: title => (title ? `${title} · NUK Cafe Admin` : 'NUK Cafe Admin'),
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
