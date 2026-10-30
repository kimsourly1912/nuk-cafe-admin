<script setup lang="ts">
/**
 * A task-flow page (`<TaskFrame>`) until the browser knows who is signed in (D238): someone already
 * signed in goes on, or is told the workspace refuses them, so the form must not show first. Shaped
 * like the form with `fields` fields and the submit button, so the form takes its place without
 * moving. `cafe`: a workspace sign-in's header (the cafe's logo and name); else an account page's
 * (a back link, the title and a line under it).
 */
defineProps<{ fields: number, cafe?: boolean }>()
</script>

<template>
  <TaskFrame>
    <template #header>
      <div
        v-if="cafe"
        class="flex items-center gap-2"
      >
        <USkeleton class="size-6 rounded-full" />
        <USkeleton class="h-6 w-40" />
      </div>
      <template v-else>
        <USkeleton class="mb-2 h-5 w-28" />
        <USkeleton class="h-7 w-32" />
        <USkeleton class="mt-2 h-4 w-full max-w-64" />
      </template>
    </template>
    <div
      role="status"
      aria-label="Loading"
      class="space-y-4"
    >
      <div
        v-for="field in fields"
        :key="field"
        class="space-y-2"
      >
        <USkeleton class="h-4 w-20" />
        <USkeleton class="h-8 w-full" />
      </div>
    </div>
    <template #footer>
      <USkeleton class="h-8 w-full" />
    </template>
  </TaskFrame>
</template>
