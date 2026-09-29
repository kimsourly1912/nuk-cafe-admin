<script setup lang="ts">
/**
 * The Sample menu card (D94, the owner's mockups): what the sample menu creates, the size to load,
 * and the menu's state: empty (Load), other data (reset first), a load in progress or stopped
 * partway (its steps; Continue loading / Try again), or loaded (a summary and links). Success is a
 * status, never a button: the only buttons are actions.
 */
import type { SampleDataState, SampleMenuSize } from '#shared/contracts/sample-data'
import { SAMPLE_MENU_ITEMS } from '#shared/contracts/sample-data'
import { currentStage, itemCount, menuStatus, menuSummary, SIZE_OPTIONS } from '../utils/state'

const props = defineProps<{
  state: SampleDataState
  /** This card's load is running. */
  loading: boolean
  /** Another card's action is running. */
  busy: boolean
  error?: string
}>()
const emit = defineEmits<{ load: [size: SampleMenuSize] }>()

const status = computed(() => menuStatus(props.state))
const run = computed(() => props.state.menu.run)
const chosen = ref<SampleMenuSize>(props.state.menu.run?.size ?? 'standard')
// An unfinished load continues at its own size.
watch(() => props.state.menu.run?.size, (size) => {
  if (size) chosen.value = size
})
const stage = computed(() => (run.value ? currentStage(run.value.stages) : undefined))
const showSteps = computed(() => props.loading || status.value === 'partial')

const INCLUDES = [
  ['8 categories', 'Coffee, Tea, Frappé, Bakery'],
  ['3 option sets', 'Size, Temperature, Sweetness'],
  ['4 add-on groups', 'Milk, Syrups, Extras, Toppings'],
  ['2 availability rules', 'Breakfast, Late night'],
  ['Drafts, archived and sold-out items', 'every state the screens show'],
  ['No photos', 'add them on Menu items'],
] as const

function stageIcon(key: string) {
  const current = stage.value?.key === key
  const entry = run.value?.stages.find(s => s.key === key)
  if (entry && entry.done >= entry.total) return { name: 'i-lucide-circle-check', class: 'text-success' }
  if (current && props.loading) return { name: 'i-lucide-loader-circle', class: 'animate-spin text-primary' }
  if (current && props.error) return { name: 'i-lucide-circle-alert', class: 'text-error' }
  return { name: 'i-lucide-circle', class: 'text-dimmed' }
}
</script>

<template>
  <UCard
    as="section"
    aria-labelledby="sample-menu"
  >
    <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div class="min-w-0 space-y-1">
        <h2
          id="sample-menu"
          class="text-lg font-semibold text-highlighted"
        >
          Sample menu
        </h2>
        <p class="text-sm text-muted">
          A complete cafe menu, created through the normal admin rules.
        </p>
      </div>
    </div>

    <ul class="mt-4 space-y-1 text-sm">
      <li>
        <span class="font-medium text-highlighted">{{ SAMPLE_MENU_ITEMS[chosen] }} menu items</span>
        <span class="text-muted"> · English names, $1.50–$4.25</span>
      </li>
      <li
        v-for="[title, detail] in INCLUDES"
        :key="title"
      >
        <span class="font-medium text-highlighted">{{ title }}</span>
        <span class="text-muted"> · {{ detail }}</span>
      </li>
    </ul>

    <USeparator class="my-4" />

    <!-- Loading, or stopped partway: the steps -->
    <div
      v-if="showSteps && run"
      class="space-y-3"
    >
      <p class="text-sm font-medium text-highlighted">
        {{ loading ? `Loading the ${run.size} sample menu…` : `Sample menu partly loaded (${run.stages.at(-1)?.done} of ${run.stages.at(-1)?.total} items)` }}
      </p>
      <ol
        class="divide-y divide-default"
        aria-label="Loading steps"
        aria-live="polite"
      >
        <li
          v-for="entry in run.stages"
          :key="entry.key"
          class="flex flex-col gap-2 py-2"
        >
          <div class="flex items-center gap-3">
            <UIcon
              v-bind="stageIcon(entry.key)"
              class="size-5 shrink-0"
            />
            <span class="flex-1 text-sm">{{ entry.label }}</span>
            <span class="text-sm tabular-nums text-muted">{{ entry.done }}/{{ entry.total }}</span>
          </div>
          <UProgress
            v-if="entry.key === 'items' && entry.done < entry.total && entry.done > 0"
            :model-value="entry.done"
            :max="entry.total"
            size="sm"
            class="ps-8"
          />
        </li>
      </ol>
      <UAlert
        v-if="error && !loading"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Loading stopped"
        :description="error"
      />
      <p
        v-if="loading"
        class="text-sm text-muted"
      >
        Keep this page open. Leaving it pauses loading; come back to continue.
      </p>
    </div>

    <!-- Loaded -->
    <div
      v-else-if="status === 'loaded'"
      class="space-y-3"
    >
      <UAlert
        color="success"
        variant="subtle"
        icon="i-lucide-circle-check"
        title="Sample menu loaded"
        :description="menuSummary(state.menu.counts)"
      />
      <p class="flex items-center gap-2 text-sm text-muted">
        <UIcon
          name="i-lucide-image"
          class="size-4 shrink-0"
        />
        Items have no photos yet: add them on the Menu items page.
      </p>
      <div class="flex flex-wrap gap-x-4 gap-y-1">
        <UButton
          label="View menu items"
          to="/admin/products"
          variant="link"
          trailing-icon="i-lucide-chevron-right"
          class="px-0"
        />
        <UButton
          label="View the customer menu"
          to="/"
          target="_blank"
          variant="link"
          trailing-icon="i-lucide-external-link"
          class="px-0"
        />
      </div>
    </div>

    <!-- Other data on the menu -->
    <div
      v-else-if="status === 'other'"
      class="flex items-center gap-2 text-sm text-muted"
    >
      <UIcon
        name="i-lucide-info"
        class="size-4 shrink-0"
      />
      The menu already has data ({{ itemCount(state.menu.counts) }} items). Reset it to load the sample menu.
    </div>

    <!-- Empty: choose a size -->
    <URadioGroup
      v-else
      v-model="chosen"
      legend="Menu size"
      :items="SIZE_OPTIONS"
      orientation="horizontal"
      variant="card"
      :disabled="busy || loading"
      :ui="{ fieldset: 'flex-col sm:flex-row' }"
    />

    <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p class="text-sm text-muted">
        <template v-if="status === 'loaded'">
          The menu already has data. Reset it to load again.
        </template>
        <template v-else-if="status === 'empty'">
          Current state: menu is empty.
        </template>
      </p>
      <UButton
        v-if="status === 'empty' || status === 'partial' || loading"
        :label="loading ? 'Loading…' : status === 'partial' ? (error ? 'Try again' : 'Continue loading') : 'Load sample menu'"
        :loading="loading"
        :disabled="busy"
        icon="i-lucide-download"
        class="justify-center max-sm:w-full"
        @click="emit('load', chosen)"
      />
    </div>
  </UCard>
</template>
