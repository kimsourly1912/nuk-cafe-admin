<script setup lang="ts">
import CounterReportsPage from '~/features/reports/components/CounterReportsPage.vue'

definePageMeta({ layout: 'counter', title: 'Summary', branchPermission: 'report:read' })
</script>

<template>
  <CounterReportsPage report="summary" />
</template>
