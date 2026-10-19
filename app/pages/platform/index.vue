<script setup lang="ts">
import PlatformOverviewPage from '~/features/platform/components/PlatformOverviewPage.vue'

definePageMeta({
  layout: 'platform',
  title: 'Overview',
  // The Cafes list lived here before P3 (D191): its old links (`/platform?status=…`) open it.
  middleware: to => (Object.keys(to.query).length ? navigateTo({ path: '/platform/cafes', query: to.query }, { replace: true }) : undefined),
})
</script>

<template>
  <PlatformOverviewPage />
</template>
