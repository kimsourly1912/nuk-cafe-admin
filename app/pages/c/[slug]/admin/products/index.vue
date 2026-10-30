<script setup lang="ts">
import ProductListPage from '~/features/products/components/ProductListPage.vue'

definePageMeta({ title: 'Menu items', permission: 'menu:read' })
</script>

<template>
  <ProductListPage />
</template>
