<script setup lang="ts">
/**
 * Placeholder while a branch loads: the Settings tab's own layout (heading, three status cards, then
 * the information and hours cards in the same 2/5 + 3/5 grid), so the width and height match the
 * content and nothing jumps when it arrives.
 */
</script>

<template>
  <div
    role="status"
    aria-label="Loading the branch…"
    class="space-y-6"
  >
    <span class="sr-only">Loading the branch…</span>
    <div class="space-y-2">
      <USkeleton class="h-5 w-40" />
      <USkeleton class="h-4 w-full max-w-md" />
    </div>

    <div class="divide-y divide-default rounded-lg border border-default sm:grid sm:grid-cols-3 sm:gap-4 sm:divide-y-0 sm:border-0">
      <div
        v-for="i in 3"
        :key="i"
        class="flex items-center gap-3 p-4 sm:rounded-lg sm:border sm:border-default"
      >
        <USkeleton class="size-5 shrink-0 rounded-full sm:size-6" />
        <div class="flex-1 space-y-2">
          <USkeleton class="h-4 w-1/3 sm:w-2/3" />
          <USkeleton class="hidden h-5 w-1/2 sm:block" />
        </div>
      </div>
    </div>

    <div class="grid items-start gap-6 lg:grid-cols-5">
      <UCard
        variant="outline"
        class="lg:col-span-2"
      >
        <div class="space-y-4">
          <div class="space-y-2">
            <USkeleton class="h-5 w-1/2" />
            <USkeleton class="h-4 w-3/4" />
          </div>
          <USkeleton
            v-for="i in 3"
            :key="i"
            class="h-9 w-full"
          />
        </div>
      </UCard>
      <UCard
        variant="outline"
        class="lg:col-span-3"
      >
        <div class="space-y-4">
          <div class="space-y-2">
            <USkeleton class="h-5 w-1/3" />
            <USkeleton class="h-4 w-2/3" />
          </div>
          <USkeleton
            v-for="i in 7"
            :key="i"
            class="h-9 w-full"
          />
        </div>
      </UCard>
    </div>
  </div>
</template>
