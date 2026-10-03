<script setup lang="ts">
/**
 * A cafe's mark beside its name (D143): its logo when it has one, else the coffee icon. Size it with
 * a class (`size-5`, `size-6`); decorative, since the cafe's name is always beside it.
 *
 * @example
 * <CafeLogo :url="logoUrl" class="size-5" />
 */
defineProps<{ url: string | null | undefined }>()
</script>

<template>
  <img
    v-if="url"
    :src="url"
    alt=""
    class="shrink-0 rounded-md object-cover"
  >
  <UIcon
    v-else
    name="i-lucide-coffee"
    class="shrink-0 text-primary"
  />
</template>
