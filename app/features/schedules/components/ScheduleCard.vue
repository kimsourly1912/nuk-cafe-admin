<script setup lang="ts">
/**
 * A schedule in the list: name, the week as 7 day pills, the time range on a 24-hour bar, the
 * number of menu items, status. Days and times are already in the viewer's zone (the page
 * converts them, D33). Clicking the card opens it; the checkbox and the ⋮ menu don't.
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { ScheduleListResponse } from '~/generated/api'
import type { Day } from '../utils/days'
import { DAYS, formatDays, formatTimeRange, timeBarSegments } from '../utils/days'

const props = defineProps<{
  schedule: ScheduleListResponse
  /** Days and times in the viewer's zone; `zone` is set when the record's zone couldn't be converted. */
  local: { days: Day[], startTime: string, endTime: string, zone?: string }
  actions: DropdownMenuItem[]
  selected: boolean
  busy?: boolean
}>()

const emit = defineEmits<{ open: [], select: [value: boolean] }>()

const inactive = computed(() => props.schedule.status === 'INACTIVE')
const segments = computed(() => timeBarSegments(props.local.startTime, props.local.endTime))
const itemCount = computed(() => props.schedule.item_count ?? 0)

function onClick(event: MouseEvent) {
  if ((event.target as HTMLElement).closest('a, button, input, label')) return
  emit('open')
}
</script>

<template>
  <article
    class="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border bg-default p-4 transition hover:shadow-md focus-within:ring-2 focus-within:ring-primary"
    :class="[selected ? 'border-primary ring-1 ring-primary' : 'border-default', busy && 'pointer-events-none opacity-50']"
    :aria-label="schedule.name"
    :aria-busy="busy || undefined"
    @click="onClick"
  >
    <UCheckbox
      :model-value="selected"
      :aria-label="`Select ${schedule.name}`"
      @update:model-value="value => emit('select', !!value)"
    />

    <div class="min-w-32 flex-1">
      <h3
        class="font-medium text-highlighted"
        :class="inactive && 'text-muted'"
      >
        {{ schedule.name }}
      </h3>
      <p
        v-if="schedule.description"
        class="line-clamp-1 text-sm text-muted"
      >
        {{ schedule.description }}
      </p>
    </div>

    <!-- The week: which days it runs. -->
    <div
      role="img"
      :aria-label="formatDays(local.days)"
      class="flex gap-1"
    >
      <span
        v-for="day in DAYS"
        :key="day.value"
        class="flex size-7 items-center justify-center rounded-full text-xs font-medium"
        :class="local.days.includes(day.value) ? (inactive ? 'bg-accented text-default' : 'bg-primary text-inverted') : 'bg-elevated text-dimmed'"
        :title="day.label"
      >{{ day.label[0] }}</span>
    </div>

    <!-- The day: when it runs, on a 24-hour bar. -->
    <div class="w-48 space-y-1.5">
      <p class="text-sm tabular-nums">
        {{ formatTimeRange(local.startTime, local.endTime) }}
        <span
          v-if="local.zone"
          class="text-xs text-muted"
        >{{ local.zone }}</span>
      </p>
      <div
        class="relative h-1.5 overflow-hidden rounded-full bg-elevated"
        aria-hidden="true"
      >
        <span
          v-for="(segment, i) in segments"
          :key="i"
          class="absolute inset-y-0 rounded-full"
          :class="inactive ? 'bg-accented' : 'bg-primary'"
          :style="{ left: `${segment.left}%`, width: `${segment.width}%` }"
        />
      </div>
      <div
        class="flex justify-between text-[10px] text-dimmed"
        aria-hidden="true"
      >
        <span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>12 AM</span>
      </div>
    </div>

    <div class="w-24 text-sm text-muted">
      {{ itemCount }} {{ itemCount === 1 ? 'menu item' : 'menu items' }}
    </div>

    <!-- Fixed width: "Inactive" is wider than "Active" and would shift the pills and bar. -->
    <div class="w-20">
      <StatusBadge :status="schedule.status" />
    </div>

    <UIcon
      v-if="busy"
      name="i-lucide-loader-circle"
      class="size-5 animate-spin text-muted"
      aria-label="Working…"
    />
    <UDropdownMenu
      v-else
      :items="actions"
      :content="{ align: 'end' }"
    >
      <UButton
        icon="i-lucide-ellipsis-vertical"
        color="neutral"
        variant="ghost"
        :aria-label="`Actions for ${schedule.name}`"
      />
    </UDropdownMenu>
  </article>
</template>
