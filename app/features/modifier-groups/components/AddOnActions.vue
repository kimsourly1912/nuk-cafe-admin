<script setup lang="ts">
/**
 * An add-on's ⋮ actions (D75): a dropdown menu from `sm`, a bottom sheet (`UDrawer`) with the
 * add-on's name, its actions and Cancel on phones (owner, 2026-09-28). A disabled action shows why.
 *
 * @example
 * <AddOnActions name="Oat milk" :actions="[{ label: 'Edit add-on', icon: 'i-lucide-pencil', onSelect: edit }]" />
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import { useMediaQuery } from '@vueuse/core'

export interface AddOnAction {
  label: string
  icon: string
  onSelect: () => void
  color?: 'error'
  disabled?: boolean
  /** Why it's disabled. */
  description?: string
}

const props = defineProps<{ name: string, actions: AddOnAction[] }>()

const phone = useMediaQuery('(max-width: 639px)')
const open = ref(false)

const menuItems = computed<DropdownMenuItem[]>(() => props.actions.map(action => ({ ...action })))

function choose(action: AddOnAction) {
  open.value = false
  action.onSelect()
}
</script>

<template>
  <UDrawer
    v-if="phone"
    v-model:open="open"
    :title="name"
    description="Add-on actions"
    :ui="{ description: 'sr-only' }"
  >
    <UButton
      icon="i-lucide-ellipsis-vertical"
      color="neutral"
      variant="ghost"
      :aria-label="`Actions for ${name}`"
    />
    <template #body>
      <ul class="divide-y divide-default">
        <li
          v-for="action in actions"
          :key="action.label"
          class="py-1"
        >
          <UButton
            :label="action.label"
            :icon="action.icon"
            :color="action.color ?? 'neutral'"
            variant="ghost"
            block
            class="justify-start"
            :disabled="action.disabled"
            @click="choose(action)"
          />
          <p
            v-if="action.description"
            class="px-2.5 pb-1 text-sm text-muted"
          >
            {{ action.description }}
          </p>
        </li>
      </ul>
    </template>
    <template #footer>
      <UButton
        label="Cancel"
        color="neutral"
        variant="outline"
        block
        class="mb-[env(safe-area-inset-bottom)]"
        @click="open = false"
      />
    </template>
  </UDrawer>
  <UDropdownMenu
    v-else
    :items="menuItems"
    :content="{ align: 'end' }"
  >
    <UButton
      icon="i-lucide-ellipsis-vertical"
      color="neutral"
      variant="ghost"
      :aria-label="`Actions for ${name}`"
    />
  </UDropdownMenu>
</template>
