<script setup lang="ts">
/**
 * One active add-on on its group's page (D75, D82). The name is the row's one target: it opens the
 * add-on's Edit dialog; the ⋮ actions sit beside it (the compact row composition, page-patterns §2).
 * Laid out by the add-ons list's container (`@container`), not the viewport: from `@md` it's a table
 * row (name, default price, a Preselected checkbox that saves when ticked, actions); narrower it
 * stacks the price under the name, marks a preselected add-on, and Preselect is in the ⋮ menu.
 * On an archived group it's read-only. The page owns the data; this renders and emits.
 */
import type { Modifier } from '#shared/contracts/menu-modifiers'
import type { AddOnAction } from './AddOnActions.vue'
import { formatMinor } from '~/utils/money'
import AddOnActions from './AddOnActions.vue'

const props = defineProps<{
  modifier: Modifier
  actions: AddOnAction[]
  readOnly?: boolean
  busy?: boolean
  /** Why it can't be pre-selected now (the group's maximum), if so. */
  preselectBlocked?: string
}>()

const emit = defineEmits<{ 'edit': [], 'toggle-default': [value: boolean] }>()

const name = computed(() => props.modifier.name)
</script>

<template>
  <li
    :aria-label="name"
    class="flex items-center gap-3 py-2 @md:gap-4"
  >
    <UButton
      v-if="!readOnly"
      color="neutral"
      variant="ghost"
      :aria-label="name"
      :disabled="busy"
      class="-mx-2.5 min-w-0 flex-1 text-left"
      @click="emit('edit')"
    >
      <span class="flex min-w-0 flex-col items-start">
        <span class="max-w-full break-words font-normal text-highlighted">{{ name }}</span>
        <span class="font-normal text-muted @md:hidden">Default price {{ formatMinor(modifier.priceDeltaMinor) }}</span>
      </span>
    </UButton>
    <div
      v-else
      class="min-w-0 flex-1"
    >
      <p class="break-words text-highlighted">
        {{ name }}
      </p>
      <p class="text-sm text-muted @md:hidden">
        Default price {{ formatMinor(modifier.priceDeltaMinor) }}
      </p>
    </div>

    <span class="hidden w-24 shrink-0 text-right tabular-nums @md:block">{{ formatMinor(modifier.priceDeltaMinor) }}</span>

    <!-- Preselected: a checkbox in the wide layout (saves when ticked), a mark when narrow -->
    <div class="hidden w-36 shrink-0 @md:block">
      <UTooltip
        :text="preselectBlocked"
        :disabled="!preselectBlocked || modifier.isDefault"
      >
        <UCheckbox
          :model-value="modifier.isDefault"
          :label="modifier.isDefault ? 'Yes' : 'No'"
          :aria-label="`${name} is preselected`"
          :disabled="readOnly || busy || (!modifier.isDefault && !!preselectBlocked)"
          @update:model-value="value => emit('toggle-default', !!value)"
        />
      </UTooltip>
    </div>
    <UBadge
      v-if="modifier.isDefault"
      label="Preselected"
      icon="i-lucide-circle-check"
      color="success"
      variant="subtle"
      class="shrink-0 @md:hidden"
    />

    <div class="flex w-12 shrink-0 justify-end">
      <AddOnActions
        v-if="!readOnly"
        :name="name"
        :actions="actions"
      />
    </div>
  </li>
</template>
