<script setup lang="ts">
import PromotionPage from '~/features/promotions/components/PromotionPage.vue'

definePageMeta({ title: 'Promotion', permission: 'menu:read' })

const route = useRoute()
const id = computed(() => String(route.params.id))
</script>

<template>
  <PromotionPage
    :id="id"
    :key="id"
  />
</template>
