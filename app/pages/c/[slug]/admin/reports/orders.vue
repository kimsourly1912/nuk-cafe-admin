<script setup lang="ts">
import OrderHistoryPage from '~/features/reports/components/OrderHistoryPage.vue'

definePageMeta({ title: 'Order history', permission: 'report:read' })
</script>

<template>
  <OrderHistoryPage />
</template>
