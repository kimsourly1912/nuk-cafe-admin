<script setup lang="ts">
import CounterReportsPage from '~/features/reports/components/CounterReportsPage.vue'

definePageMeta({ layout: 'counter', title: 'Order history' })
</script>

<template>
  <CounterReportsPage report="orders" />
</template>
