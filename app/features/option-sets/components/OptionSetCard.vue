<script setup lang="ts">
/**
 * A set in the library (D73, on the design system's `UCard` since D74): the name with one generic
 * icon, how many active values it has (and archived ones), its active values as chips in their
 * stored order, what uses it, and an Edit (or View, when archived) button that opens the editor.
 * The ⋮ menu holds only Archive or Restore. While searching, values that match are listed.
 *
 * Chips: 3 on a narrow card, 5 once the card is `@sm` (24rem) wide, then "+N more". The card is its
 * own container (D86): in the two-column grid from `lg` a card is narrower than on a tablet.
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { OptionSet } from '#shared/contracts/menu-options'
import { activeValues, archivedValues } from '../composables/useOptionSets'
import { usageLabel, valueCountLabel } from '../schemas/option-set-display'

const props = defineProps<{
  set: OptionSet
  actions: DropdownMenuItem[]
  busy?: boolean
  /** Active values matching the search, for the "Matches" line. */
  matches?: string[]
}>()

const emit = defineEmits<{ open: [] }>()

const archived = computed(() => props.set.status === 'archived')
const values = computed(() => activeValues(props.set))
const hidden = computed(() => archivedValues(props.set).length)
const meta = computed(() => [valueCountLabel(values.value.length), hidden.value && `${hidden.value} archived`].filter(Boolean).join(' · '))

const PHONE_CHIPS = 3
const WIDE_CHIPS = 5
const chipClass = (index: number) => (index < PHONE_CHIPS ? '' : index < WIDE_CHIPS ? 'hidden @sm:block' : 'hidden')
</script>

<template>
  <UCard
    as="article"
    variant="outline"
    :aria-label="set.name"
    :aria-busy="busy || undefined"
    :class="busy && 'pointer-events-none opacity-50'"
    :ui="{ root: '@container flex flex-col', body: 'flex-1 space-y-3' }"
  >
    <div class="flex items-start gap-3">
      <UIcon
        name="i-lucide-sliders-horizontal"
        class="mt-0.5 size-5 shrink-0"
        :class="archived ? 'text-muted' : 'text-primary'"
      />
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <h3
            class="min-w-0 break-words font-semibold"
            :class="archived ? 'text-muted' : 'text-highlighted'"
          >
            {{ set.name }}
          </h3>
          <UBadge
            v-if="archived"
            label="Archived"
            color="neutral"
            variant="subtle"
            size="sm"
          />
        </div>
        <p class="text-sm text-muted">
          {{ meta }}
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
          :aria-label="`Actions for ${set.name}`"
        />
      </UDropdownMenu>
    </div>

    <div class="flex flex-wrap items-center gap-1">
      <ul
        :aria-label="`Values of ${set.name}`"
        class="contents"
      >
        <li
          v-for="(value, i) in values"
          :key="value.id"
          :class="chipClass(i)"
        >
          <UBadge
            :label="value.name"
            color="neutral"
            variant="outline"
          />
        </li>
      </ul>
      <span
        v-if="values.length > PHONE_CHIPS"
        class="text-xs text-muted @sm:hidden"
      >+{{ values.length - PHONE_CHIPS }} more</span>
      <span
        v-if="values.length > WIDE_CHIPS"
        class="hidden text-xs text-muted @sm:inline"
      >+{{ values.length - WIDE_CHIPS }} more</span>
    </div>

    <p
      v-if="matches?.length"
      class="text-sm"
    >
      <span class="text-muted">Matches:</span> {{ matches.join(', ') }}
    </p>

    <template #footer>
      <div class="flex items-center justify-between gap-3">
        <p class="text-sm text-muted">
          {{ usageLabel(set.itemCount) }}
        </p>
        <UButton
          :label="archived ? 'View' : 'Edit'"
          :icon="archived ? 'i-lucide-eye' : 'i-lucide-pencil'"
          color="neutral"
          variant="outline"
          :aria-label="`${archived ? 'View' : 'Edit'} ${set.name}`"
          @click="emit('open')"
        />
      </div>
    </template>
  </UCard>
</template>
