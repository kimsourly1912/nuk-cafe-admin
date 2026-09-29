<script setup lang="ts">
import BranchPage from '~/features/branches/components/BranchPage.vue'

definePageMeta({ title: 'Branch' })

const route = useRoute()
const id = computed(() => String(route.params.id))
</script>

<template>
  <BranchPage
    :id="id"
    :key="id"
  />
</template>
