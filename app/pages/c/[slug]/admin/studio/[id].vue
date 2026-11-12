<script setup lang="ts">
import StudioPage from '~/features/branches/components/StudioPage.vue'

definePageMeta({ title: 'Studio', layout: false, permission: 'branch:update' })

const route = useRoute()
const id = computed(() => String(route.params.id))
</script>

<template>
  <StudioPage
    :id="id"
    :key="id"
  />
</template>
