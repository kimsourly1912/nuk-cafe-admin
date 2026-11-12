<script setup lang="ts">
import StudioBranchesPage from '~/features/branches/components/StudioBranchesPage.vue'

definePageMeta({ title: 'Studio', permission: 'branch:update' })
</script>

<template>
  <StudioBranchesPage />
</template>
