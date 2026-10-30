<script setup lang="ts">
import PromotionListPage from '~/features/promotions/components/PromotionListPage.vue'

definePageMeta({ title: 'Promotions', permission: 'menu:read' })
</script>

<template>
  <PromotionListPage />
</template>
