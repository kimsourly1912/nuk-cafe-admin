<script setup lang="ts">
/**
 * "Reset menu data?" (D94): exactly what's deleted, with counts, and what's kept. The red button
 * works once RESET is typed. Full screen on phones. It stays open while the reset runs (the photos
 * go a batch at a time) and closes when everything is gone.
 */
import type { SampleDataState } from '#shared/contracts/sample-data'
import { itemCount } from '../utils/state'

const props = defineProps<{
  state: SampleDataState
  resetting: boolean
}>()
const emit = defineEmits<{ reset: [] }>()
const open = defineModel<boolean>('open', { default: false })

const { isCompact } = useLayoutContext()
const typed = ref('')
watch(open, (isOpen) => {
  if (isOpen) typed.value = ''
})

const deleted = computed(() => {
  const counts = props.state.menu.counts
  return [
    { icon: 'i-lucide-folder', text: pluralize(counts.categories, ['category', 'categories']) },
    { icon: 'i-lucide-coffee', text: pluralize(itemCount(counts), ['menu item', 'menu items']) },
    { icon: 'i-lucide-sliders-horizontal', text: pluralize(counts.optionSets, ['option set', 'option sets']) },
    { icon: 'i-lucide-list-plus', text: pluralize(counts.modifierGroups, ['add-on group', 'add-on groups']) },
    { icon: 'i-lucide-clock', text: pluralize(counts.availabilityRules, ['availability rule', 'availability rules']) },
    { icon: 'i-lucide-image', text: pluralize(counts.photos, ['uploaded photo', 'uploaded photos']) },
  ]
})
const confirmed = computed(() => typed.value.trim() === 'RESET')
</script>

<template>
  <UModal
    v-model:open="open"
    title="Reset menu data?"
    :fullscreen="isCompact"
    :dismissible="!resetting"
    :close="!resetting"
  >
    <template #body>
      <form
        id="reset-menu-form"
        class="space-y-4"
        @submit.prevent="confirmed && !resetting && emit('reset')"
      >
        <div>
          <p class="text-sm font-medium text-highlighted">
            This permanently deletes:
          </p>
          <ul class="mt-2 space-y-1.5">
            <li
              v-for="entry in deleted"
              :key="entry.icon"
              class="flex items-center gap-2 text-sm"
            >
              <UIcon
                :name="entry.icon"
                class="size-4 shrink-0 text-muted"
              />
              {{ entry.text }}
            </li>
          </ul>
          <p class="mt-2 text-sm text-muted">
            Sold-out switches go too.
          </p>
        </div>
        <USeparator />
        <div>
          <p class="text-sm font-medium text-highlighted">
            Kept
          </p>
          <p class="text-sm text-muted">
            Branches, opening hours, tables, staff and accounts.
          </p>
        </div>
        <USeparator />
        <p class="text-sm font-semibold text-error">
          This can't be undone.
        </p>
        <UFormField
          label="Type RESET to confirm"
          name="confirm"
        >
          <UInput
            v-model="typed"
            autocomplete="off"
            :disabled="resetting"
            class="w-full"
          />
        </UFormField>
      </form>
    </template>
    <template #footer>
      <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <UButton
          label="Cancel"
          color="neutral"
          variant="outline"
          class="justify-center"
          :disabled="resetting"
          @click="open = false"
        />
        <UButton
          type="submit"
          form="reset-menu-form"
          label="Reset menu data"
          color="error"
          icon="i-lucide-trash-2"
          class="justify-center"
          :loading="resetting"
          :disabled="!confirmed"
        />
      </div>
    </template>
  </UModal>
</template>
