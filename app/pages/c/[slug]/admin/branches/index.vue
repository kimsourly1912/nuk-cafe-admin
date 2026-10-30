<script setup lang="ts">
import BranchListPage from '~/features/branches/components/BranchListPage.vue'

definePageMeta({ title: 'Branches', permission: 'branch:read' })
</script>

<template>
  <BranchListPage />
</template>
