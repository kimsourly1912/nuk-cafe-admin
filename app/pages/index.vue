<script setup lang="ts">
import PlatformHomePage from '~/features/platform/components/PlatformHomePage.vue'

// The site's root is the platform's, never a cafe's (D221).
definePageMeta({ layout: 'auth', title: 'Angder' })
</script>

<template>
  <PlatformHomePage />
</template>
