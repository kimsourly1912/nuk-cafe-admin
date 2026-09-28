<script setup lang="ts">
/**
 * An add-on group in the list: its name, its rules in words, its add-ons with their default
 * prices, and how many menu items offer it. Clicking the card opens the editor; the ⋮ menu doesn't.
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { ModifierGroup } from '#shared/contracts/menu-modifiers'
import { activeModifiers, archivedModifiers } from '../composables/useModifierGroups'
import { describeRules, formatDelta } from '../schemas/modifier-group-form'

const props = defineProps<{
  group: ModifierGroup
  actions: DropdownMenuItem[]
  busy?: boolean
}>()

const emit = defineEmits<{ open: [] }>()

const archived = computed(() => props.group.status === 'archived')
const hidden = computed(() => archivedModifiers(props.group).length)

function onClick(event: MouseEvent) {
  if ((event.target as HTMLElement).closest('a, button, input, label')) return
  emit('open')
}
</script>

<template>
  <article
    class="flex cursor-pointer flex-wrap items-start gap-x-4 gap-y-2 rounded-lg border border-default bg-default p-4 transition hover:shadow-md focus-within:ring-2 focus-within:ring-primary"
    :class="busy && 'pointer-events-none opacity-50'"
    :aria-label="group.name"
    :aria-busy="busy || undefined"
    @click="onClick"
  >
    <div class="min-w-40 flex-1 space-y-2">
      <h3
        class="font-medium"
        :class="archived ? 'text-muted' : 'text-highlighted'"
      >
        {{ group.name }}
        <UBadge
          v-if="archived"
          label="Archived"
          color="neutral"
          variant="subtle"
          size="sm"
          class="ml-1"
        />
      </h3>
      <p class="text-xs text-muted">
        {{ describeRules(group.minSelect, group.maxSelect) }}
      </p>
      <div class="flex flex-wrap items-center gap-1">
        <ul
          :aria-label="`Add-ons in ${group.name}`"
          class="contents"
        >
          <li
            v-for="modifier in activeModifiers(group)"
            :key="modifier.id"
          >
            <UBadge
              color="neutral"
              variant="outline"
            >
              {{ modifier.name }}
              <span class="text-muted">{{ formatDelta(modifier.priceDeltaMinor) }}</span>
              <UIcon
                v-if="modifier.isDefault"
                name="i-lucide-check"
                class="size-3"
                aria-label="pre-selected"
              />
            </UBadge>
          </li>
        </ul>
        <span
          v-if="hidden"
          class="text-xs text-muted"
        >+ {{ hidden }} archived</span>
      </div>
    </div>

    <p class="w-40 text-sm text-muted">
      {{ group.itemCount ? `Offered by ${pluralize(group.itemCount, ['menu item', 'menu items'])}` : 'Not offered yet' }}
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
        :aria-label="`Actions for ${group.name}`"
      />
    </UDropdownMenu>
  </article>
</template>
