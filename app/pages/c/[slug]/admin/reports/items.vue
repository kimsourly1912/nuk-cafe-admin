<script setup lang="ts">
import ItemSalesPage from '~/features/reports/components/ItemSalesPage.vue'

definePageMeta({ title: 'Sales by item', permission: 'report:read' })
</script>

<template>
  <ItemSalesPage />
</template>
