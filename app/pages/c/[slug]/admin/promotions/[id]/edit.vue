<script setup lang="ts">
import PromotionEditorPage from '~/features/promotions/components/PromotionEditorPage.vue'

definePageMeta({ title: 'Edit promotion' })

const route = useRoute()
const id = computed(() => String(route.params.id))
</script>

<template>
  <PromotionEditorPage
    :id="id"
    :key="id"
  />
</template>
