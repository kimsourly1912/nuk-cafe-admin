<script setup lang="ts">
import CounterReportsPage from '~/features/reports/components/CounterReportsPage.vue'

definePageMeta({ layout: 'counter', title: 'Sales by item', branchPermission: 'report:read' })
</script>

<template>
  <CounterReportsPage report="items" />
</template>
