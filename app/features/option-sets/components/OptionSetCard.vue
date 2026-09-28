<script setup lang="ts">
/**
 * A set in the list: its name, its active values in order as chips, archived ones counted, and how
 * many menu items use it. Clicking the card opens the editor; the ⋮ menu doesn't.
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { OptionSet } from '#shared/contracts/menu-options'
import { activeValues, archivedValues } from '../composables/useOptionSets'

const props = defineProps<{
  set: OptionSet
  actions: DropdownMenuItem[]
  busy?: boolean
}>()

const emit = defineEmits<{ open: [] }>()

const archived = computed(() => props.set.status === 'archived')
const hidden = computed(() => archivedValues(props.set).length)

function onClick(event: MouseEvent) {
  if ((event.target as HTMLElement).closest('a, button, input, label')) return
  emit('open')
}
</script>

<template>
  <article
    class="flex cursor-pointer flex-wrap items-start gap-x-4 gap-y-2 rounded-lg border border-default bg-default p-4 transition hover:shadow-md focus-within:ring-2 focus-within:ring-primary"
    :class="busy && 'pointer-events-none opacity-50'"
    :aria-label="set.name"
    :aria-busy="busy || undefined"
    @click="onClick"
  >
    <div class="min-w-40 flex-1 space-y-2">
      <h3
        class="font-medium"
        :class="archived ? 'text-muted' : 'text-highlighted'"
      >
        {{ set.name }}
        <UBadge
          v-if="archived"
          label="Archived"
          color="neutral"
          variant="subtle"
          size="sm"
          class="ml-1"
        />
      </h3>
      <div class="flex flex-wrap items-center gap-1">
        <ul
          :aria-label="`Values of ${set.name}`"
          class="contents"
        >
          <li
            v-for="value in activeValues(set)"
            :key="value.id"
          >
            <UBadge
              :label="value.name"
              color="neutral"
              variant="outline"
            />
          </li>
        </ul>
        <span
          v-if="hidden"
          class="text-xs text-muted"
        >+ {{ hidden }} archived</span>
      </div>
    </div>

    <p class="w-40 text-sm text-muted">
      {{ set.itemCount ? `Used by ${pluralize(set.itemCount, ['menu item', 'menu items'])}` : 'Not used yet' }}
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
        :aria-label="`Actions for ${set.name}`"
      />
    </UDropdownMenu>
  </article>
</template>
