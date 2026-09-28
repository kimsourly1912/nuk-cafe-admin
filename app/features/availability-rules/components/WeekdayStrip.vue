<script setup lang="ts">
/**
 * A rule's week at a glance (D76): seven badges, Monday first. Days the rule opens on are outlined in
 * the primary color with a dot; the others are muted. Each day is also named in words for screen
 * readers ("Monday: open"), so the state never relies on color alone. In a narrow card the seven
 * share the row's width; in a wide one (`@4xl`, the card's container) they sit side by side.
 */
const props = defineProps<{ days: ReadonlySet<number> }>()

const WEEK = [
  { value: 1, letter: 'M', name: 'Monday' },
  { value: 2, letter: 'T', name: 'Tuesday' },
  { value: 3, letter: 'W', name: 'Wednesday' },
  { value: 4, letter: 'T', name: 'Thursday' },
  { value: 5, letter: 'F', name: 'Friday' },
  { value: 6, letter: 'S', name: 'Saturday' },
  { value: 7, letter: 'S', name: 'Sunday' },
]
const on = (day: number) => props.days.has(day)
</script>

<template>
  <ul
    aria-label="Weekly schedule"
    class="grid grid-cols-7 gap-1.5 @4xl:flex"
  >
    <li
      v-for="day in WEEK"
      :key="day.value"
    >
      <UBadge
        :color="on(day.value) ? 'primary' : 'neutral'"
        :variant="on(day.value) ? 'outline' : 'soft'"
        class="w-full flex-col justify-center gap-0.5 py-1 @4xl:w-8"
        :class="!on(day.value) && 'text-dimmed'"
        aria-hidden="true"
      >
        <span>{{ day.letter }}</span>
        <span
          class="size-1 rounded-full"
          :class="on(day.value) ? 'bg-primary' : 'bg-transparent'"
        />
      </UBadge>
      <span class="sr-only">{{ day.name }}: {{ on(day.value) ? 'open' : 'closed' }}</span>
    </li>
  </ul>
</template>
