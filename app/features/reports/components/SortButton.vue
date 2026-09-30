<script setup lang="ts" generic="T extends string">
/**
 * A sortable column's header (the reports' tables sort on the server, D111): the name, the current
 * direction's arrow, and a click to sort by it or turn it round.
 */
const props = defineProps<{
  label: string
  column: T
  sort: T
  direction: 'asc' | 'desc'
  /** The direction a first click sorts in: names A–Z, numbers highest first. */
  first?: 'asc' | 'desc'
  align?: 'left' | 'right'
}>()
const emit = defineEmits<{ sort: [column: T, direction: 'asc' | 'desc'] }>()

const active = computed(() => props.sort === props.column)
const icon = computed(() => {
  if (!active.value) return 'i-lucide-arrow-up-down'
  return props.direction === 'asc' ? 'i-lucide-arrow-up-narrow-wide' : 'i-lucide-arrow-down-wide-narrow'
})
const described = computed(() => {
  if (!active.value) return `Sort by ${props.label.toLowerCase()}`
  return `${props.label}, sorted ${props.direction === 'asc' ? 'ascending' : 'descending'}`
})

function onClick() {
  if (active.value) emit('sort', props.column, props.direction === 'asc' ? 'desc' : 'asc')
  else emit('sort', props.column, props.first ?? 'desc')
}
</script>

<template>
  <UButton
    :label="label"
    :trailing-icon="icon"
    color="neutral"
    variant="ghost"
    size="sm"
    :aria-label="described"
    :class="[align === 'right' ? '-me-2.5 ms-auto' : '-ms-2.5', active ? 'text-highlighted' : 'text-muted']"
    :ui="{ trailingIcon: active ? '' : 'opacity-50' }"
    @click="onClick"
  />
</template>
