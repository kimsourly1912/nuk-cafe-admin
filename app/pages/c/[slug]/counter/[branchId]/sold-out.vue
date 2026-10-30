<script setup lang="ts">
import CounterSoldOutPage from '~/features/counter/components/CounterSoldOutPage.vue'

definePageMeta({ layout: 'counter', title: 'Sold out', branchPermission: 'menu:read' })
</script>

<template>
  <CounterSoldOutPage />
</template>
