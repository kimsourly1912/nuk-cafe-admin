<script setup lang="ts">
/**
 * A rule in the library, as a weekly agenda (D76). One reading path, left to right when the card is
 * `@4xl` (56rem) wide and top to bottom when narrower (the card is its own container, D87: beside
 * the sidebar at 1024px it's too narrow for one row): who it is and what uses it, the week at a glance, its times grouped by
 * days ("Mon–Fri · 6:30 AM – 11:00 AM", overnight ones marked "next day"), then Manage (View when
 * archived) and the ⋮ menu. The card grows with its times; nothing is truncated.
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { AvailabilityRule } from '#shared/contracts/menu-availability'
import { activeWeekdays, scheduleLines, usageSummary } from '../utils/windows'
import WeekdayStrip from './WeekdayStrip.vue'

const props = defineProps<{
  rule: AvailabilityRule
  actions: DropdownMenuItem[]
  busy?: boolean
}>()

const emit = defineEmits<{ open: [] }>()

const archived = computed(() => props.rule.status === 'archived')
const lines = computed(() => scheduleLines(props.rule.windows))
const days = computed(() => activeWeekdays(props.rule.windows))
</script>

<template>
  <UCard
    as="article"
    variant="outline"
    :aria-label="rule.name"
    :aria-busy="busy || undefined"
    class="relative"
    :class="busy && 'pointer-events-none opacity-50'"
    :ui="{ root: '@container', body: 'flex flex-col gap-4 @4xl:flex-row @4xl:items-start @4xl:gap-6' }"
  >
    <!-- Identity and usage -->
    <div class="flex items-start gap-3 pr-10 @4xl:w-64 @4xl:shrink-0 @4xl:pr-0">
      <UIcon
        name="i-lucide-calendar-clock"
        class="mt-0.5 size-5 shrink-0"
        :class="archived ? 'text-muted' : 'text-primary'"
      />
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <h3
            class="min-w-0 break-words font-semibold"
            :class="archived ? 'text-muted' : 'text-highlighted'"
          >
            {{ rule.name }}
          </h3>
          <UBadge
            :label="archived ? 'Archived' : 'Active'"
            :color="archived ? 'neutral' : 'success'"
            variant="subtle"
            size="sm"
          />
        </div>
        <p class="text-sm text-muted">
          {{ usageSummary(rule) }}
        </p>
      </div>
    </div>

    <USeparator class="@4xl:hidden" />

    <!-- The week at a glance -->
    <div class="@4xl:shrink-0">
      <p class="mb-1.5 text-xs font-medium text-muted">
        Weekly schedule
      </p>
      <WeekdayStrip :days="days" />
    </div>

    <!-- Times -->
    <p
      v-if="!lines.length"
      class="min-w-0 flex-1 text-sm text-muted"
    >
      No times yet
    </p>
    <ul
      v-else
      :aria-label="`Times of ${rule.name}`"
      class="min-w-0 flex-1 space-y-1.5 text-sm"
    >
      <li
        v-for="line in lines"
        :key="`${line.days} ${line.times}`"
        class="flex items-start gap-2"
      >
        <UIcon
          name="i-lucide-clock"
          class="mt-0.5 size-4 shrink-0 text-muted"
        />
        <span class="w-28 shrink-0 text-muted">{{ line.days }}</span>
        <span class="ms-auto text-right tabular-nums @4xl:ms-0 @4xl:text-left">
          {{ line.times }}
          <span
            v-if="line.nextDay"
            class="block text-xs text-muted"
          >next day</span>
        </span>
      </li>
    </ul>

    <!-- Actions: Manage / View; ⋮ sits top-right on phones -->
    <div class="flex items-center gap-2 @4xl:shrink-0">
      <UButton
        :label="archived ? 'View' : 'Manage'"
        :aria-label="`${archived ? 'View' : 'Manage'} ${rule.name}`"
        color="neutral"
        variant="outline"
        class="justify-center @max-4xl:flex-1"
        @click="emit('open')"
      />
      <div class="absolute right-4 top-4 @4xl:static">
        <UIcon
          v-if="busy"
          name="i-lucide-loader-circle"
          class="m-1.5 size-5 animate-spin text-muted"
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
            :aria-label="`Actions for ${rule.name}`"
          />
        </UDropdownMenu>
      </div>
    </div>
  </UCard>
</template>
