<script setup lang="ts">
import CounterTablesPage from '~/features/branches/components/CounterTablesPage.vue'

definePageMeta({ layout: 'counter', title: 'Dining tables', branchPermission: 'table:manage' })
</script>

<template>
  <CounterTablesPage />
</template>
