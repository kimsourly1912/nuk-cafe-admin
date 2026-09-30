<script setup lang="ts">
/**
 * Queue | Finished today (24) (step 10.2, D116, the owner's frames): two links, one per page, so
 * each view has its own address and Back works. The business day's start is noted beside it.
 */
const props = defineProps<{
  branchId: string
  current: 'queue' | 'finished'
  /** How many finished today; left out until known. */
  finishedCount?: number | null
}>()

const views = computed(() => [
  { id: 'queue', label: 'Queue', to: `/counter/${props.branchId}` },
  { id: 'finished', label: props.finishedCount == null ? 'Finished today' : `Finished today (${props.finishedCount})`, to: `/counter/${props.branchId}/finished` },
])
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
    <nav
      aria-label="Counter views"
      class="inline-flex rounded-lg bg-elevated p-1 max-sm:w-full"
    >
      <UButton
        v-for="view in views"
        :key="view.id"
        :to="view.to"
        :label="view.label"
        :color="view.id === current ? 'primary' : 'neutral'"
        :variant="view.id === current ? 'solid' : 'ghost'"
        :aria-current="view.id === current ? 'page' : undefined"
        class="justify-center max-sm:flex-1"
      />
    </nav>
    <p class="text-sm text-muted max-sm:hidden">
      Today · Business day starts at 4:00 AM
    </p>
  </div>
</template>
