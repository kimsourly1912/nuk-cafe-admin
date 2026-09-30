<script setup lang="ts">
/**
 * The order's four steps (Paid → Preparing → Ready → Picked up; the 6.5 frames, D114): done steps
 * checked, the current one highlighted. Not shown for a cancelled order.
 */
import type { OrderStatus } from '#shared/contracts/orders'
import { trackerSteps } from '../utils/order'

const props = defineProps<{ status: OrderStatus }>()
const steps = computed(() => trackerSteps(props.status))
const stateText = { done: 'done', current: 'now', upcoming: 'not yet' } as const
</script>

<template>
  <ol
    class="grid grid-cols-4"
    aria-label="Progress"
  >
    <li
      v-for="(step, index) in steps"
      :key="step.label"
      class="relative flex flex-col items-center gap-1.5 text-center"
      :aria-current="step.state === 'current' ? 'step' : undefined"
    >
      <!-- The line to the previous step, behind the circles. -->
      <span
        v-if="index > 0"
        class="absolute top-3.5 right-1/2 h-0.5 w-full -translate-y-1/2"
        :class="step.state === 'upcoming' ? 'bg-accented' : 'bg-primary'"
        aria-hidden="true"
      />
      <span
        class="relative z-10 flex size-7 items-center justify-center rounded-full"
        :class="{
          'bg-primary text-inverted': step.state === 'done',
          'bg-primary text-inverted ring-4 ring-primary/25': step.state === 'current',
          'border-2 border-accented bg-default': step.state === 'upcoming',
        }"
        aria-hidden="true"
      >
        <UIcon
          v-if="step.state === 'done'"
          name="i-lucide-check"
          class="size-4"
        />
        <span
          v-else-if="step.state === 'current'"
          class="size-2 rounded-full bg-default"
        />
      </span>
      <span
        class="text-xs"
        :class="step.state === 'upcoming' ? 'text-muted' : 'font-medium text-highlighted'"
      >
        {{ step.label }}<span class="sr-only">: {{ stateText[step.state] }}</span>
      </span>
    </li>
  </ol>
</template>
