<script setup lang="ts">
/**
 * One category in the tree (D72). A flex row on small screens (name, a meta line, status, ⋮) and a
 * grid row from `md` (category · contains · availability · status · ⋮, lined up with the
 * header by `rowColumns`). What the leading controls show depends on the page's mode:
 * - browse: the expand toggle (parents); the name opens the edit form (active categories);
 * - select: a checkbox, and the name toggles it too (a larger touch target);
 * - reorder: Move up / Move down buttons, and from `md` a drag handle (↑/↓ on it also moves).
 * The row itself isn't clickable, so its controls never fight over a click.
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { MenuCategory } from '#shared/contracts/menu-categories'
import { availabilityLabel, contentsLabel, rowColumns } from '../schemas/category-display'

export type CategoryPageMode = 'browse' | 'select' | 'reorder'

const props = defineProps<{
  category: MenuCategory
  level: 'main' | 'sub'
  mode: CategoryPageMode
  actions: DropdownMenuItem[]
  /** Status badges (All and Archived views; the Active view doesn't repeat "Active"). */
  showStatus: boolean
  selected?: boolean
  /** Select mode: this row can be selected (its status matches the view). */
  selectable?: boolean
  busy?: boolean
  /** Shown only as the parent of matching subcategories. */
  contextOnly?: boolean
  /** Parents: subcategories shown under it, and whether they're expanded. */
  subCount?: number
  expanded?: boolean
  /** Reorder mode: whether it can move up / down among its siblings. */
  canMoveUp?: boolean
  canMoveDown?: boolean
  /** Subcategories: the last row of its group (the connector line stops here). */
  last?: boolean
  /** Each availability rule's times in words, by rule id (for the tooltip), when loaded. */
  ruleTimes?: ReadonlyMap<string, string>
}>()

const emit = defineEmits<{
  'open': []
  'select': [value: boolean]
  'toggle': []
  'move': [by: -1 | 1]
  'handle-keydown': [event: KeyboardEvent]
}>()

const name = computed(() => props.category.name)
const archived = computed(() => props.category.status === 'archived')
const isMain = computed(() => props.level === 'main')
const availability = computed(() => availabilityLabel(props.category, props.ruleTimes))
/** "2 subcategories", "12 items" or "Empty". */
const contents = computed(() => contentsLabel(props.category))
/** Mobile meta line: "2 subcategories · Always". */
const meta = computed(() => `${contents.value} · ${availability.value.label}`)

/** The name is a button when it does something: open (browse, active) or select (select mode). */
const nameAction = computed<'open' | 'select' | undefined>(() => {
  if (props.mode === 'select') return props.selectable ? 'select' : undefined
  if (props.mode === 'browse' && !archived.value && !props.contextOnly) return 'open'
  return undefined
})

function onName() {
  if (nameAction.value === 'open') emit('open')
  else if (nameAction.value === 'select') emit('select', !props.selected)
}
</script>

<template>
  <div
    class="relative flex items-center gap-2 px-3 py-2 transition-colors md:gap-4 md:px-4"
    :class="[
      rowColumns(showStatus),
      isMain ? 'min-h-16 bg-elevated/40' : 'min-h-14',
      selected && 'bg-primary/10',
      busy && 'pointer-events-none opacity-50',
    ]"
    :aria-busy="busy || undefined"
  >
    <!-- Category: [connector] [reorder | toggle | checkbox] name, description -->
    <div
      class="flex min-w-0 flex-1 items-center gap-1 md:gap-2"
      :class="!isMain && 'pl-8 md:pl-10'"
    >
      <template v-if="!isMain">
        <span
          aria-hidden="true"
          class="absolute left-7 top-0 border-l border-dashed border-accented md:left-8"
          :class="last ? 'h-1/2' : 'h-full'"
        />
        <span
          aria-hidden="true"
          class="absolute left-7 top-1/2 w-4 border-t border-dashed border-accented md:left-8"
        />
      </template>

      <template v-if="mode === 'reorder'">
        <UButton
          icon="i-lucide-grip-vertical"
          color="neutral"
          variant="ghost"
          class="hidden cursor-grab md:inline-flex"
          v-bind="{ [isMain ? 'data-main-handle' : 'data-sub-handle']: category.id }"
          :aria-label="`Reorder ${name} (drag, or press up or down)`"
          @keydown="emit('handle-keydown', $event)"
        />
        <UButton
          icon="i-lucide-arrow-up"
          color="neutral"
          variant="ghost"
          :disabled="!canMoveUp"
          data-move="up"
          :aria-label="`Move ${name} up`"
          @click="emit('move', -1)"
        />
        <UButton
          icon="i-lucide-arrow-down"
          color="neutral"
          variant="ghost"
          :disabled="!canMoveDown"
          data-move="down"
          :aria-label="`Move ${name} down`"
          @click="emit('move', 1)"
        />
      </template>

      <template v-else-if="isMain">
        <UButton
          v-if="subCount"
          :icon="expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          color="neutral"
          variant="ghost"
          :aria-label="`${expanded ? 'Collapse' : 'Expand'} ${name}`"
          :aria-expanded="expanded"
          @click="emit('toggle')"
        />
        <span
          v-else
          class="w-8 shrink-0"
        />
      </template>

      <div
        v-if="mode === 'select'"
        class="flex size-8 shrink-0 items-center justify-center"
      >
        <UCheckbox
          v-if="selectable"
          :model-value="selected"
          :aria-label="`Select ${name}`"
          @update:model-value="value => emit('select', !!value)"
        />
      </div>

      <div class="min-w-0 flex-1 py-1">
        <component
          :is="nameAction ? 'button' : 'span'"
          :type="nameAction ? 'button' : undefined"
          class="line-clamp-2 max-w-full break-words rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          :class="[
            isMain ? 'text-base font-semibold text-highlighted' : 'text-default',
            (archived || contextOnly) && 'text-muted',
            nameAction && 'cursor-pointer hover:underline',
          ]"
          :tabindex="nameAction === 'select' ? -1 : undefined"
          @click="onName"
        >
          {{ name }}
        </component>
        <p
          v-if="category.description"
          class="line-clamp-2 text-sm text-muted md:line-clamp-1"
        >
          {{ category.description }}
        </p>
        <p class="truncate text-sm text-muted md:hidden">
          {{ meta }}
        </p>
      </div>
    </div>

    <!-- Desktop columns -->
    <span class="hidden text-sm text-muted md:block">{{ contents }}</span>
    <UTooltip
      :text="availability.full"
      :content="{ side: 'top' }"
    >
      <span
        class="hidden min-w-0 items-center gap-1.5 text-sm md:flex"
        :class="availability.unrestricted ? 'text-muted' : 'text-default'"
      >
        <UIcon
          v-if="!availability.unrestricted"
          name="i-lucide-clock"
          class="size-4 shrink-0 text-muted"
        />
        <span class="truncate">{{ availability.label }}</span>
        <span class="sr-only">{{ availability.full }}</span>
      </span>
    </UTooltip>

    <div
      v-if="showStatus"
      class="shrink-0"
    >
      <UBadge
        v-if="archived"
        label="Archived"
        icon="i-lucide-archive"
        color="neutral"
        variant="subtle"
      />
      <UBadge
        v-else
        label="Active"
        icon="i-lucide-circle-check"
        color="success"
        variant="subtle"
      />
    </div>

    <div class="flex shrink-0 justify-end">
      <UIcon
        v-if="busy"
        name="i-lucide-loader-circle"
        class="size-5 animate-spin text-muted"
        aria-label="Working…"
      />
      <UDropdownMenu
        v-else-if="mode !== 'reorder' && actions.length"
        :items="actions"
        :content="{ align: 'end' }"
      >
        <UButton
          icon="i-lucide-ellipsis-vertical"
          color="neutral"
          variant="ghost"
          :aria-label="`Actions for ${name}`"
        />
      </UDropdownMenu>
    </div>
  </div>
</template>
