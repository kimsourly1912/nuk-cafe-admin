<script setup lang="ts">
/** The account pages' picture panel (`AuthAside`) with the cafe on top. */
import AccountBrand from './AccountBrand.vue'

defineProps<{ title: string, text: string }>()
</script>

<template>
  <AuthAside
    :title="title"
    :text="text"
  >
    <AccountBrand />
  </AuthAside>
</template>
