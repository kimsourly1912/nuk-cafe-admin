<script setup lang="ts">
/**
 * Create/edit a menu item in a slide-over (D70; the route `ProductEditorPage` is the other surface,
 * D90). Open via `useOverlay().create(ProductFormSlideover)` with `itemId` (it loads the whole item:
 * the list has summaries) or nothing for a new one; emits `close(true)` when saved. The state and
 * save live in `useItemEditor`, the fields in `ProductFormFields`. Like the other forms it stays
 * open while saving but can be closed: the save continues, and a failure offers "Reopen" with the
 * input restored. An archived item is shown read-only.
 */
import type { MenuItem } from '#shared/contracts/menu-items'
import { useItemEditor } from '../composables/useItemEditor'
import type { ItemForm } from '../schemas/item-form'
import { ITEM_STATUS_LABELS } from '../utils/item-display'
import ProductFormFields from './ProductFormFields.vue'
import ProductFormSlideover from './ProductFormSlideover.vue'

const props = defineProps<{
  /** The item to edit: loaded here. Omit (with `item`) to create a new one. */
  itemId?: string
  /** The item as already loaded ("Reopen" after a failed background save). */
  item?: MenuItem
  /** Restores unsaved input (used by "Reopen"). */
  draft?: ItemForm
}>()

// `update:open` is declared so closing (X, Esc, outside click) goes through `unsaved` instead of
// straight to the overlay.
const emit = defineEmits<{ 'close': [saved: boolean], 'update:open': [open: boolean] }>()

const overlay = useOverlay()
const editor = useItemEditor({
  itemId: props.itemId,
  item: props.item,
  draft: props.draft,
  onLoaded: () => unsaved.markClean(),
  reopen: (item, draft) => overlay.create(ProductFormSlideover, { destroyOnClose: true }).open({ item, draft }),
})
const { isEdit, itemQuery, loaded, ready, archived, state, saving, uploading, lastError } = editor

const unsaved = useModalUnsavedChanges(state, {
  initial: editor.initial,
  paused: saving,
  close: () => emit('close', false),
})

const fields = useTemplateRef('fields')
useSubmitShortcut(() => fields.value?.submit())

async function onSubmit() {
  const result = await editor.save()
  if (!result.ok) {
    fields.value?.setServerErrors(result.error?.fieldErrors)
    return
  }
  unsaved.markClean()
  emit('close', true)
}
</script>

<template>
  <USlideover
    :title="isEdit ? (archived ? 'Archived menu item' : 'Edit menu item') : 'New menu item'"
    :description="loaded ? `Status: ${ITEM_STATUS_LABELS[loaded.status]}` : 'Saved as a draft: publish it from the list when it\'s ready.'"
    :ui="{ content: 'max-w-2xl' }"
    @update:open="unsaved.onOpenChange"
  >
    <template #body>
      <ApiErrorAlert
        v-if="itemQuery?.error.value"
        :error="itemQuery.error.value"
        title="Could not load the menu item"
        @retry="itemQuery.refresh()"
      />
      <ListSkeleton
        v-else-if="!ready"
        label="Loading the menu item…"
        variant="row"
      />
      <ProductFormFields
        v-else
        ref="fields"
        v-model:uploading="uploading"
        :state="state"
        form-id="product-form"
        :disabled="saving || archived"
        :archived="archived"
        :last-error="lastError"
        autofocus
        @submit="onSubmit"
      />
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-end gap-2">
        <span
          v-if="saving || uploading"
          class="mr-auto text-xs text-muted"
        >
          {{ uploading ? 'Waiting for the image upload…' : 'You can close this; saving continues in the background.' }}
        </span>
        <UButton
          :label="saving || archived ? 'Close' : 'Cancel'"
          color="neutral"
          variant="outline"
          @click="unsaved.requestClose()"
        />
        <UTooltip
          v-if="!archived"
          :text="isEdit ? 'Save' : 'Create'"
          :kbds="['meta', 'enter']"
        >
          <UButton
            type="submit"
            form="product-form"
            :label="isEdit ? 'Save' : 'Create'"
            :loading="saving"
            :disabled="uploading || !ready"
          />
        </UTooltip>
      </div>
    </template>
  </USlideover>
</template>
