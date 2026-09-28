<script setup lang="ts">
import ProductEditorPage from '~/features/products/components/ProductEditorPage.vue'

definePageMeta({ title: 'Menu item' })

const route = useRoute()
const id = computed(() => String(route.params.id))
</script>

<template>
  <ProductEditorPage
    :id="id"
    :key="id"
  />
</template>
