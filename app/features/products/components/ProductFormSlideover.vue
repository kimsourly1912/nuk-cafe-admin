<script setup lang="ts">
/**
 * Create/edit a menu item in a slide-over (D70; the route `ProductEditorPage` is the other surface,
 * D90). Open via `useOverlay().create(ProductFormSlideover)` with `itemId` (it loads the whole item:
 * the list has summaries) or nothing for a new one; emits `close(true)` when saved. The state and
 * save live in `useItemEditor`, the fields in `ProductFormFields`. Like the other forms it stays
 * open while saving but can be closed: the save continues, and a failure offers "Reopen" with the
 * input restored. An archived item is shown read-only. A new item or a draft also has "Save and
 * publish" / "Create and publish" (D125): saved, then published; a refused publish leaves a draft.
 */
import type { MenuItem } from '#shared/contracts/menu-items'
import { useItemEditor } from '../composables/useItemEditor'
import type { ItemForm } from '../schemas/item-form'
import ProductFormFields from './ProductFormFields.vue'
import ViewOnMenuButton from './ViewOnMenuButton.vue'
import ProductFormSlideover from './ProductFormSlideover.vue'

const props = defineProps<{
  /** The item to edit: loaded here. Omit (with `item`) to create a new one. */
  itemId?: string
  /** The item as already loaded ("Reopen" after a failed background save). */
  item?: MenuItem
  /** Restores unsaved input (used by "Reopen"). */
  draft?: ItemForm
  /** Duplicate (D154): a new item filled from this one. */
  copyOf?: string
  /** Menu items' "No photo" filter (D160): Save says it opens the next item (the list does that). */
  saveAndNext?: boolean
}>()

// `update:open` is declared so closing (X, Esc, outside click) goes through `unsaved` instead of
// straight to the overlay.
const emit = defineEmits<{ 'close': [saved: boolean], 'update:open': [open: boolean] }>()

const overlay = useOverlay()
const editor = useItemEditor({
  itemId: props.itemId,
  item: props.item,
  draft: props.draft,
  copyOf: props.copyOf,
  onLoaded: () => unsaved.markClean(),
  onReloaded: saved => unsaved.markClean(saved),
  reopen: (item, draft) => overlay.create(ProductFormSlideover, { destroyOnClose: true }).open({ item, draft }),
})
const { isEdit, itemQuery, loaded, ready, archived, canPublish, state, saving, uploading, photoPending, photoWait, lastError, conflict, reloading, reloaded } = editor

const unsaved = useModalUnsavedChanges(state, {
  initial: editor.initial,
  paused: saving,
  pending: photoPending,
  draft: editor.keptDraft,
  close: () => emit('close', false),
})

/** Save, Create, or Save and next (D160). */
const saveLabel = computed(() => (!isEdit ? 'Create' : props.saveAndNext ? 'Save and next' : 'Save'))

const fields = useTemplateRef('fields')
/** Which button submitted the form: "Save and publish" sets it (D125); Save and Ctrl/⌘+Enter clear it. */
const publishNext = ref(false)
function submit(publish: boolean) {
  publishNext.value = publish
  fields.value?.submit()
}
useSubmitShortcut(() => submit(false))

async function onSubmit() {
  const result = await editor.save({ publish: publishNext.value })
  publishNext.value = false
  if (!result.ok) {
    fields.value?.setServerErrors(result.error?.fieldErrors)
    return
  }
  unsaved.markSaved()
  emit('close', true)
}
</script>

<template>
  <USlideover
    :title="isEdit ? (archived ? 'Archived menu item' : 'Edit menu item') : 'New menu item'"
    :description="editor.summary.value"
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
      <template v-else>
        <FormDraftAlert
          :draft="unsaved.draft"
          record="menu item"
          class="mb-4"
        />
        <ProductFormFields
          ref="fields"
          v-model:uploading="uploading"
          v-model:photo-pending="photoPending"
          :state="state"
          form-id="product-form"
          :disabled="saving || archived"
          :archived="archived"
          :last-error="lastError"
          :conflict="conflict"
          :reloading="reloading"
          :reloaded="reloaded"
          autofocus
          @submit="onSubmit"
          @reload="editor.reload"
        />
      </template>
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-end gap-2">
        <div
          v-if="loaded && !saving && !photoPending"
          class="mr-auto"
        >
          <ViewOnMenuButton
            :item-id="loaded.id"
            :status="loaded.status"
          />
        </div>
        <span
          v-else-if="saving || photoPending"
          class="mr-auto text-xs text-muted"
        >
          {{ photoWait || 'You can close this; saving continues in the background.' }}
        </span>
        <UButton
          :label="saving || archived ? 'Close' : 'Cancel'"
          color="neutral"
          variant="outline"
          @click="unsaved.requestClose()"
        />
        <UButton
          v-if="canPublish"
          :label="isEdit ? 'Save and publish' : 'Create and publish'"
          color="neutral"
          variant="outline"
          :loading="saving && publishNext"
          :disabled="photoPending || !ready || saving"
          @click="submit(true)"
        />
        <UTooltip
          v-if="!archived"
          :text="saveLabel"
          :kbds="['meta', 'enter']"
        >
          <UButton
            type="submit"
            form="product-form"
            :label="saveLabel"
            :loading="saving && !publishNext"
            :disabled="photoPending || !ready || (saving && publishNext)"
            @click="publishNext = false"
          />
        </UTooltip>
      </div>
    </template>
  </USlideover>
</template>
