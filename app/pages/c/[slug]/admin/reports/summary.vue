<script setup lang="ts">
import SummaryPage from '~/features/reports/components/SummaryPage.vue'

definePageMeta({ title: 'Summary', permission: 'report:read' })
</script>

<template>
  <SummaryPage />
</template>
