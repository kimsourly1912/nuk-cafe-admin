<script setup lang="ts">
import ModifierGroupPage from '~/features/modifier-groups/components/ModifierGroupPage.vue'

definePageMeta({ title: 'Add-on group' })

const route = useRoute()
const id = computed(() => String(route.params.id))
</script>

<template>
  <ModifierGroupPage
    :id="id"
    :key="id"
  />
</template>
