<script setup lang="ts">
/**
 * A rule in the list: its name, each time as a line ("Mon–Fri · 7:00 AM – 11:00 AM") and what uses
 * it. Clicking the card opens it; the ⋮ menu doesn't.
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { AvailabilityRule } from '#shared/contracts/menu-availability'
import { usageLabel } from '../composables/useAvailabilityRules'
import { toRows } from '../schemas/availability-rule-form'
import { formatRow } from '../utils/windows'

const props = defineProps<{
  rule: AvailabilityRule
  actions: DropdownMenuItem[]
  busy?: boolean
}>()

const emit = defineEmits<{ open: [] }>()

const archived = computed(() => props.rule.status === 'archived')
const lines = computed(() => toRows(props.rule.windows).map(row => formatRow({ days: row.days, start: row.start!, end: row.end! })))

function onClick(event: MouseEvent) {
  if ((event.target as HTMLElement).closest('a, button, input, label')) return
  emit('open')
}
</script>

<template>
  <article
    class="flex cursor-pointer flex-wrap items-start gap-x-4 gap-y-2 rounded-lg border border-default bg-default p-4 transition hover:shadow-md focus-within:ring-2 focus-within:ring-primary"
    :class="busy && 'pointer-events-none opacity-50'"
    :aria-label="rule.name"
    :aria-busy="busy || undefined"
    @click="onClick"
  >
    <div class="min-w-40 flex-1 space-y-1">
      <h3
        class="font-medium"
        :class="archived ? 'text-muted' : 'text-highlighted'"
      >
        {{ rule.name }}
        <UBadge
          v-if="archived"
          label="Archived"
          color="neutral"
          variant="subtle"
          size="sm"
          class="ml-1"
        />
      </h3>
      <ul class="space-y-0.5 text-sm tabular-nums">
        <li
          v-for="line in lines"
          :key="line"
        >
          {{ line }}
        </li>
      </ul>
    </div>

    <p class="w-56 text-sm text-muted">
      {{ usageLabel(rule) }}
    </p>

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
        :aria-label="`Actions for ${rule.name}`"
      />
    </UDropdownMenu>
  </article>
</template>
