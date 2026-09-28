<script setup lang="ts">
/**
 * A group in the Add-ons library (D75): the generic Add-ons icon, the name, a Required / Optional
 * badge and the rule, its active add-ons as compact rows (name, default price aligned right,
 * pre-selected ones marked), what offers it, and Manage (or View, when archived) to open its page.
 * The ⋮ menu holds only Archive or Restore. While searching, the add-ons that match are listed.
 *
 * Rows: 3 on phones, 4 from `sm`, then "+N more" (CSS decides, so no resize listener).
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { ModifierGroup } from '#shared/contracts/menu-modifiers'
import { activeModifiers } from '../composables/useModifierGroups'
import { formatDelta, ruleParts, usageLabel } from '../schemas/modifier-group-display'

const props = defineProps<{
  group: ModifierGroup
  actions: DropdownMenuItem[]
  busy?: boolean
  /** Active add-ons matching the search, for the "Matches" line. */
  matches?: string[]
}>()

const archived = computed(() => props.group.status === 'archived')
const addOns = computed(() => activeModifiers(props.group))
const rule = computed(() => ruleParts(props.group.minSelect, props.group.maxSelect))

const PHONE_ROWS = 3
const WIDE_ROWS = 4
const rowClass = (index: number) => (index < PHONE_ROWS ? 'flex' : index < WIDE_ROWS ? 'hidden sm:flex' : 'hidden')
</script>

<template>
  <UCard
    as="article"
    variant="outline"
    :aria-label="group.name"
    :aria-busy="busy || undefined"
    :class="busy && 'pointer-events-none opacity-50'"
    :ui="{ root: 'flex flex-col', body: 'flex-1 space-y-3' }"
  >
    <div class="flex items-start gap-3">
      <UIcon
        name="i-lucide-circle-plus"
        class="mt-0.5 size-5 shrink-0"
        :class="archived ? 'text-muted' : 'text-primary'"
      />
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <h3
            class="min-w-0 break-words font-semibold"
            :class="archived ? 'text-muted' : 'text-highlighted'"
          >
            {{ group.name }}
          </h3>
          <UBadge
            v-if="archived"
            label="Archived"
            color="neutral"
            variant="subtle"
            size="sm"
          />
          <UBadge
            v-else
            :label="rule.kind"
            :color="rule.kind === 'Required' ? 'success' : 'neutral'"
            variant="subtle"
            size="sm"
          />
        </div>
        <p class="text-sm text-muted">
          {{ archived ? `${rule.kind} · ${rule.summary}` : rule.summary }}
        </p>
      </div>
      <UIcon
        v-if="busy"
        name="i-lucide-loader-circle"
        class="size-5 shrink-0 animate-spin text-muted"
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
          :aria-label="`Actions for ${group.name}`"
        />
      </UDropdownMenu>
    </div>

    <ul
      v-if="addOns.length"
      :aria-label="`Add-ons in ${group.name}`"
      class="divide-y divide-default text-sm"
    >
      <li
        v-for="(addOn, i) in addOns"
        :key="addOn.id"
        :class="rowClass(i)"
        class="items-center gap-3 py-1.5"
      >
        <span class="min-w-0 flex-1 truncate">{{ addOn.name }}</span>
        <span
          v-if="addOn.isDefault"
          class="flex shrink-0 items-center gap-1 text-muted"
        >
          <UIcon
            name="i-lucide-circle-check"
            class="size-4 text-success"
          />
          <span class="hidden sm:inline">Preselected</span>
          <span class="sr-only sm:hidden">Preselected</span>
        </span>
        <span class="w-16 shrink-0 text-right tabular-nums">{{ formatDelta(addOn.priceDeltaMinor) }}</span>
      </li>
    </ul>
    <p
      v-else
      class="text-sm text-muted"
    >
      No active add-ons
    </p>
    <p
      v-if="addOns.length > PHONE_ROWS"
      class="text-xs text-muted"
      :class="addOns.length > WIDE_ROWS ? '' : 'sm:hidden'"
    >
      <span class="sm:hidden">+{{ addOns.length - PHONE_ROWS }} more</span>
      <span
        v-if="addOns.length > WIDE_ROWS"
        class="hidden sm:inline"
      >+{{ addOns.length - WIDE_ROWS }} more</span>
    </p>

    <p
      v-if="matches?.length"
      class="text-sm"
    >
      <span class="text-muted">Matches:</span> {{ matches.join(', ') }}
    </p>

    <template #footer>
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p class="text-sm text-muted">
          {{ usageLabel(group.itemCount) }}
        </p>
        <UButton
          :label="archived ? 'View' : 'Manage'"
          :to="`/add-ons/${group.id}`"
          color="neutral"
          variant="outline"
          trailing-icon="i-lucide-chevron-right"
          class="justify-center"
          :aria-label="`${archived ? 'View' : 'Manage'} ${group.name}`"
        />
      </div>
    </template>
  </UCard>
</template>
