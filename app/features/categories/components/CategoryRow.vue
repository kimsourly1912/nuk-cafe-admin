<script setup lang="ts">
/**
 * One subcategory beside its main category (D270, the row layout from D72 and D85). Laid out by its
 * list's `@container`: narrow, a stacked row (name, a meta line, ⋮); from `@xl`, its position, name,
 * contents, availability and ⋮ in line. The name block is the row's one target (page-patterns §2), a
 * Nuxt UI button. What the leading controls show depends on the mode:
 * - browse: the position; the name opens the edit form (active categories);
 * - select: a checkbox, and the name toggles it too (a larger touch target);
 * - reorder: the move controls and the position.
 * The row itself isn't clickable, so its controls never fight over a click.
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { MenuCategory } from '#shared/contracts/menu-categories'
import { availabilityLabel, contentsLabel, statusBadge } from '../schemas/category-display'
import CategoryMoveControls from './CategoryMoveControls.vue'

export type CategoryPageMode = 'browse' | 'select' | 'reorder'

const props = defineProps<{
  category: MenuCategory
  mode: CategoryPageMode
  actions: DropdownMenuItem[]
  /** Status badges (All and Archived views; the Active view doesn't repeat "Active"). */
  showStatus: boolean
  selected?: boolean
  /** Select mode: this row can be selected (its status matches the view). */
  selectable?: boolean
  busy?: boolean
  /** Its place among its siblings, 1-based, where that means something. */
  position?: number
  /** Reorder mode: whether it can move up / down among its siblings. */
  canMoveUp?: boolean
  canMoveDown?: boolean
  /** Each availability rule's times in words, by rule id (for the tooltip), when loaded. */
  ruleTimes?: ReadonlyMap<string, string>
}>()

const emit = defineEmits<{
  'open': []
  'select': [value: boolean]
  'move': [by: -1 | 1]
  'handle-keydown': [event: KeyboardEvent]
}>()

const name = computed(() => props.category.name)
const archived = computed(() => props.category.status === 'archived')
const availability = computed(() => availabilityLabel(props.category, props.ruleTimes))
/** "12 items" or "Empty". */
const contents = computed(() => contentsLabel(props.category))
/** Narrow meta line: "12 items · Inherits parent". */
const meta = computed(() => `${contents.value} · ${availability.value.label}`)
/** Muted text is under AA on the selected row's tint. */
const supporting = computed(() => props.selected ? 'text-default' : 'text-muted')

/** The name is a button when it does something: open (browse, active) or select (select mode). */
const nameAction = computed<'open' | 'select' | undefined>(() => {
  if (props.mode === 'select') return props.selectable ? 'select' : undefined
  if (props.mode === 'browse' && !archived.value) return 'open'
  return undefined
})

function onName() {
  if (nameAction.value === 'open') emit('open')
  else if (nameAction.value === 'select') emit('select', !props.selected)
}
</script>

<template>
  <div
    class="flex min-h-14 items-center gap-2 rounded-lg border border-default bg-default px-3 py-2 transition-colors @xl:gap-4"
    :class="[
      selected && 'bg-primary/10',
      busy && 'pointer-events-none opacity-50',
    ]"
    :aria-busy="busy || undefined"
  >
    <div class="flex min-w-0 flex-1 items-center gap-2">
      <CategoryMoveControls
        v-if="mode === 'reorder'"
        :id="category.id"
        :name="name"
        level="sub"
        :can-move-up="canMoveUp"
        :can-move-down="canMoveDown"
        @move="by => emit('move', by)"
        @handle-keydown="emit('handle-keydown', $event)"
      />

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
      <UBadge
        v-else-if="position"
        :label="String(position).padStart(2, '0')"
        color="neutral"
        variant="subtle"
        class="shrink-0 tabular-nums"
        :aria-label="`Position ${position}`"
      />

      <!-- The record target: a button when the name does something, plain text otherwise -->
      <!-- The name is the button, stretched over the block (D152): its name is the text on it -->
      <div
        v-if="nameAction"
        class="relative flex min-w-0 flex-1 flex-col items-start rounded-md px-2.5 py-1.5 text-sm hover:bg-elevated/50"
      >
        <span class="flex max-w-full flex-wrap items-center gap-x-2">
          <UButton
            color="neutral"
            variant="link"
            :tabindex="nameAction === 'select' ? -1 : undefined"
            class="min-h-6 p-0 text-left font-semibold text-highlighted after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-primary"
            @click="onName"
          >
            <span class="line-clamp-2 break-words">{{ name }}</span>
          </UButton>
          <UBadge
            v-if="showStatus"
            v-bind="statusBadge(category.status)"
          />
        </span>
        <span
          v-if="category.description"
          class="line-clamp-2 max-w-full @xl:line-clamp-1"
          :class="supporting"
        >{{ category.description }}</span>
        <span
          class="max-w-full @xl:hidden"
          :class="supporting"
        >{{ meta }}</span>
      </div>
      <!-- px-2.5: lined up with the names that are buttons (Nuxt UI's button padding) -->
      <div
        v-else
        class="min-w-0 flex-1 px-2.5 py-1"
      >
        <p class="flex flex-wrap items-center gap-x-2 text-sm">
          <span
            class="line-clamp-2 font-semibold break-words"
            :class="archived ? 'text-muted' : 'text-highlighted'"
          >{{ name }}</span>
          <UBadge
            v-if="showStatus"
            v-bind="statusBadge(category.status)"
          />
        </p>
        <p
          v-if="category.description"
          class="line-clamp-2 text-sm text-muted @xl:line-clamp-1"
        >
          {{ category.description }}
        </p>
        <p class="text-sm text-muted @xl:hidden">
          {{ meta }}
        </p>
      </div>
    </div>

    <!-- Wide columns -->
    <span
      class="hidden w-20 shrink-0 text-sm @xl:block"
      :class="supporting"
    >{{ contents }}</span>
    <UTooltip
      :text="availability.full"
      :content="{ side: 'top' }"
    >
      <span
        class="hidden w-32 min-w-0 shrink-0 items-center gap-1.5 text-sm @xl:flex"
        :class="availability.unrestricted ? supporting : 'text-default'"
      >
        <UIcon
          v-if="!availability.unrestricted"
          name="i-lucide-clock"
          class="size-4 shrink-0"
          :class="supporting"
        />
        <span class="truncate">{{ availability.label }}</span>
        <span class="sr-only">{{ availability.full }}</span>
      </span>
    </UTooltip>

    <div class="flex w-8 shrink-0 justify-end">
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
