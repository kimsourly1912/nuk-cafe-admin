<script setup lang="ts">
import CafeDetailPage from '~/features/platform/components/CafeDetailPage.vue'

definePageMeta({ layout: 'platform', title: 'Cafe' })

const route = useRoute()
const id = computed(() => String(route.params.id))
</script>

<template>
  <CafeDetailPage
    :id="id"
    :key="id"
  />
</template>
