<script setup lang="ts">
/**
 * A set in the library (D73): one generic icon, the name, how many active values it has (and
 * archived ones), its active values as chips in their stored order, what uses it, and an explicit
 * button that opens the editor (Edit, or View when archived; a large Manage button on phones).
 * The ⋮ menu holds only Archive or Restore. While searching, values that match are listed.
 *
 * Chips: 3 on phones, 5 from `sm`, then "+N more" (CSS decides, so no resize listener).
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
const chipClass = (index: number) => (index < PHONE_CHIPS ? '' : index < WIDE_CHIPS ? 'hidden sm:block' : 'hidden')
</script>

<template>
  <article
    class="flex flex-col gap-3 rounded-lg border border-default bg-default p-4 transition-opacity"
    :class="busy && 'pointer-events-none opacity-50'"
    :aria-label="set.name"
    :aria-busy="busy || undefined"
  >
    <div class="flex items-start gap-3">
      <div
        class="flex size-10 shrink-0 items-center justify-center rounded-lg"
        :class="archived ? 'bg-elevated text-muted' : 'bg-primary/10 text-primary'"
      >
        <UIcon
          name="i-lucide-sliders-horizontal"
          class="size-5"
        />
      </div>
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
            icon="i-lucide-archive"
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
        class="m-2.5 size-5 shrink-0 animate-spin text-muted"
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
          class="min-h-11 min-w-11 shrink-0 justify-center md:min-h-8 md:min-w-8"
          :aria-label="`Actions for ${set.name}`"
        />
      </UDropdownMenu>
    </div>

    <div class="flex flex-wrap items-center gap-1.5">
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
            class="max-w-48 truncate"
          />
        </li>
      </ul>
      <span
        v-if="values.length > PHONE_CHIPS"
        class="text-xs text-muted sm:hidden"
      >+{{ values.length - PHONE_CHIPS }} more</span>
      <span
        v-if="values.length > WIDE_CHIPS"
        class="hidden text-xs text-muted sm:inline"
      >+{{ values.length - WIDE_CHIPS }} more</span>
    </div>

    <p
      v-if="matches?.length"
      class="text-sm text-default"
    >
      <span class="text-muted">Matches:</span> {{ matches.join(', ') }}
    </p>

    <div class="mt-auto flex flex-col gap-3 border-t border-default pt-3 sm:flex-row sm:items-center sm:justify-between">
      <p class="flex items-center gap-1.5 text-sm text-muted">
        <UIcon
          name="i-lucide-utensils"
          class="size-4 shrink-0"
        />
        {{ usageLabel(set.itemCount) }}
      </p>
      <UButton
        :label="archived ? 'View' : 'Edit'"
        :icon="archived ? 'i-lucide-eye' : 'i-lucide-pencil'"
        color="neutral"
        variant="outline"
        class="hidden sm:inline-flex"
        :aria-label="`${archived ? 'View' : 'Edit'} ${set.name}`"
        @click="emit('open')"
      />
      <UButton
        :label="archived ? 'View' : 'Manage'"
        color="neutral"
        variant="outline"
        size="lg"
        block
        class="min-h-11 sm:hidden"
        :aria-label="`${archived ? 'View' : 'Manage'} ${set.name}`"
        @click="emit('open')"
      />
    </div>
  </article>
</template>
