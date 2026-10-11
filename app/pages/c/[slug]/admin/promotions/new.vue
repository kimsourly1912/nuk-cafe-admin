<script setup lang="ts">
import PromotionEditorPage from '~/features/promotions/components/PromotionEditorPage.vue'

definePageMeta({ title: 'New promotion' })

const route = useRoute()
/** Run again: a new promotion filled from an earlier one. */
const copyId = computed(() => (typeof route.query.copy === 'string' ? route.query.copy : undefined))
</script>

<template>
  <PromotionEditorPage
    :key="copyId ?? 'new'"
    :copy-id="copyId"
  />
</template>
