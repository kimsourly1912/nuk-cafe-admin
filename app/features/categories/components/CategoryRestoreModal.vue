<script setup lang="ts">
/**
 * Restoring a top-level category that has archived subcategories: ask whether they come back too
 * (D72; the server restores them in the same write). Closes with the answer, or `false` on Cancel.
 *
 * @example
 * const answer = await overlay.create(CategoryRestoreModal).open({ category, archivedSubs: 2 }).result
 * if (answer) restore.execute({ ...category, withSubcategories: answer.withSubcategories })
 */
import type { MenuCategory } from '#shared/contracts/menu-categories'

const props = defineProps<{
  category: MenuCategory
  archivedSubs: number
}>()

const emit = defineEmits<{ close: [answer: false | { withSubcategories: boolean }] }>()

const withSubcategories = ref(true)
const title = computed(() => `Restore "${props.category.name}"?`)
const subs = computed(() => pluralize(props.archivedSubs, ['archived subcategory', 'archived subcategories']))
</script>

<template>
  <UModal
    :title="title"
    description="Customers will see it again, at the end of its level."
    @update:open="open => !open && emit('close', false)"
  >
    <template #body>
      <UCheckbox
        v-model="withSubcategories"
        :label="`Also restore its ${subs}`"
        description="They come back in their previous order. Leave unticked to restore them one by one later."
      />
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="outline"
          @click="emit('close', false)"
        />
        <UButton
          label="Restore"
          icon="i-lucide-archive-restore"
          autofocus
          @click="emit('close', { withSubcategories })"
        />
      </div>
    </template>
  </UModal>
</template>
