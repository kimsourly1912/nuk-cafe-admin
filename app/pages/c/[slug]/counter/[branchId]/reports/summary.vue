<script setup lang="ts">
import CounterReportsPage from '~/features/reports/components/CounterReportsPage.vue'

definePageMeta({ layout: 'counter', title: 'Summary' })
</script>

<template>
  <CounterReportsPage report="summary" />
</template>
