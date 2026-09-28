<script setup lang="ts">
/**
 * One active add-on on its group's page (D75). From `sm` a table row: name, default price,
 * Preselected (a checkbox that saves when ticked), Edit and the ⋮ actions. On phones it stacks: name,
 * "Default price $0.50", a Preselected mark, and the ⋮ sheet (which also holds Edit and Preselect).
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
    class="flex items-center gap-3 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_6rem_9rem_5rem] sm:gap-4"
  >
    <div class="min-w-0 flex-1">
      <p class="break-words text-highlighted">
        {{ name }}
      </p>
      <p class="text-sm text-muted sm:hidden">
        Default price {{ formatMinor(modifier.priceDeltaMinor) }}
      </p>
    </div>

    <span class="hidden text-right tabular-nums sm:block">{{ formatMinor(modifier.priceDeltaMinor) }}</span>

    <!-- Preselected: a checkbox from sm (saves when ticked), a mark on phones -->
    <div class="hidden sm:block">
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
      class="shrink-0 sm:hidden"
    />

    <div class="flex shrink-0 justify-end gap-1">
      <UButton
        v-if="!readOnly"
        icon="i-lucide-pencil"
        color="neutral"
        variant="ghost"
        class="hidden sm:inline-flex"
        :disabled="busy"
        :aria-label="`Edit ${name}`"
        @click="emit('edit')"
      />
      <AddOnActions
        v-if="!readOnly"
        :name="name"
        :actions="actions"
      />
    </div>
  </li>
</template>
