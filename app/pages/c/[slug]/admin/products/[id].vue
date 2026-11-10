<script setup lang="ts">
import ProductEditorPage from '~/features/products/components/ProductEditorPage.vue'

definePageMeta({ title: 'Menu item', permission: 'menu:read' })

const route = useRoute()
const id = computed(() => String(route.params.id))
// Duplicate on phones: /products/new?copy=<id> (D154).
const copyOf = computed(() => (typeof route.query.copy === 'string' ? route.query.copy : undefined))
</script>

<template>
  <ProductEditorPage
    :id="id"
    :key="`${id}:${copyOf ?? ''}`"
    :copy-of="copyOf"
  />
</template>
