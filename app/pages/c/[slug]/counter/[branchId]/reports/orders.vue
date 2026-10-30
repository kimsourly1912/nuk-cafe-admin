<script setup lang="ts">
import CounterReportsPage from '~/features/reports/components/CounterReportsPage.vue'

definePageMeta({ layout: 'counter', title: 'Order history', branchPermission: 'report:read' })
</script>

<template>
  <CounterReportsPage report="orders" />
</template>
