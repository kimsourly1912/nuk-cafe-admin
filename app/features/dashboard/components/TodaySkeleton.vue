<script setup lang="ts">
/**
 * Placeholder for "Today" while the first numbers load: the same card, header buttons and four
 * `StatCard`-sized tiles (each a single thin half-width line at the top left, as tall as a tile with its change), so nothing
 * jumps when the numbers arrive. One card (the branch count isn't known yet; most cafes have one).
 */
defineProps<{ label: string }>()
</script>

<template>
  <UCard
    role="status"
    :aria-label="label"
    :ui="{ header: 'flex flex-wrap items-center justify-between gap-x-4 gap-y-2' }"
  >
    <span class="sr-only">{{ label }}</span>
    <template #header>
      <USkeleton class="h-5 w-16" />
      <div class="flex min-w-0 gap-1">
        <USkeleton class="h-8 w-28 max-w-[45%] rounded-md" />
        <USkeleton class="h-8 w-32 max-w-[50%] rounded-md" />
      </div>
    </template>
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div
        v-for="i in 4"
        :key="i"
        class="min-h-27 min-w-0 rounded-lg bg-elevated/50 p-4 ring ring-default"
      >
        <USkeleton class="h-3 w-1/2" />
      </div>
    </div>
  </UCard>
</template>
