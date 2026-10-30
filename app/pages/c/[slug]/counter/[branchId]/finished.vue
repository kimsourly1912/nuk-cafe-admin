<script setup lang="ts">
import CounterFinishedPage from '~/features/counter/components/CounterFinishedPage.vue'

definePageMeta({ layout: 'counter', title: 'Finished today', branchPermission: 'order:read' })
</script>

<template>
  <CounterFinishedPage />
</template>
