<script setup lang="ts">
import CounterQueuePage from '~/features/counter/components/CounterQueuePage.vue'

definePageMeta({ layout: 'counter', title: 'Queue', branchPermission: 'order:read' })
</script>

<template>
  <CounterQueuePage />
</template>
