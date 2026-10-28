<script setup lang="ts">
/** The card every error page sits in, with the theme toggle in its corner. */
defineProps<{ wide?: boolean }>()
</script>

<template>
  <UCard
    class="relative w-full"
    :class="wide ? 'max-w-5xl' : 'max-w-lg'"
    :ui="{ body: 'py-10 sm:py-12' }"
  >
    <UColorModeButton class="absolute top-3 right-3" />
    <slot />
  </UCard>
</template>
