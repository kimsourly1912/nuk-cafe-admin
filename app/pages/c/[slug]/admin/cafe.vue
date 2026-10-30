<script setup lang="ts">
import CafeProfilePage from '~/features/cafe/components/CafeProfilePage.vue'

definePageMeta({ title: 'Cafe profile', permission: 'settings:manage' })
</script>

<template>
  <CafeProfilePage />
</template>
