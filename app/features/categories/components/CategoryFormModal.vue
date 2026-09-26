<script setup lang="ts">
/**
 * Create/edit form. Open via `useOverlay().create(CategoryFormModal)`; emits `close(true)` when saved.
 *
 * The modal stays open while saving so backend errors can be fixed in place, but the user may
 * close it: the save continues, and if it then fails the error toast offers "Reopen" with the
 * user's input restored.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import type { CategoryResponse } from '~/generated/api'
import { useCategoryMutations } from '../composables/useCategories'
import { categoryFormSchema, toCategoryForm, toCategoryRequest } from '../schemas/category-form'
import type { CategoryForm } from '../schemas/category-form'
import CategoryFormModal from './CategoryFormModal.vue'
import CategorySelect from './CategorySelect.vue'

const props = defineProps<{
  /** Omit to create a new category. */
  category?: CategoryResponse
  /** Restores unsaved input (used by "Reopen" after a failed background save). */
  draft?: CategoryForm
}>()

// `update:open` is declared so closing (X, Esc, outside click) goes through `unsaved` instead of
// straight to the overlay.
const emit = defineEmits<{ 'close': [saved: boolean], 'update:open': [open: boolean] }>()

const isEdit = computed(() => props.category?.id !== undefined)
const state = reactive<CategoryForm>({ ...(props.draft ?? toCategoryForm(props.category)) })

const { create, update } = useCategoryMutations()
const saving = ref(false)

// Compared with the form's original values (not the draft), so a reopened draft counts as unsaved.
const unsaved = useModalUnsavedChanges(state, {
  initial: toCategoryForm(props.category),
  paused: saving,
  close: () => emit('close', false),
})

// If the user closes the modal mid-save, a failure offers to reopen it with their input.
let closed = false
onUnmounted(() => {
  closed = true
})
const overlay = useOverlay()
function reopenActions(draft: CategoryForm) {
  if (!closed) return []
  return [{
    label: 'Reopen',
    onClick: () => overlay.create(CategoryFormModal, { destroyOnClose: true }).open({ category: props.category, draft }),
  }]
}

async function onSubmit({ data }: FormSubmitEvent<CategoryForm>) {
  const body = toCategoryRequest(data, props.category)
  const draft = { ...state }
  const overrides = { errorActions: () => reopenActions(draft) }

  saving.value = true
  const result = isEdit.value
    ? await update.execute({ id: props.category!.id!, body }, overrides)
    : await create.execute(body, overrides)
  saving.value = false

  if (!result.ok) return
  unsaved.markClean()
  emit('close', true)
}
</script>

<template>
  <UModal
    :title="isEdit ? 'Edit category' : 'New category'"
    @update:open="unsaved.onOpenChange"
  >
    <template #body>
      <UForm
        id="category-form"
        :schema="categoryFormSchema"
        :state="state"
        :disabled="saving"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField
          label="Name"
          name="categoryName"
          required
        >
          <UInput
            v-model="state.categoryName"
            class="w-full"
            autofocus
          />
        </UFormField>

        <UFormField
          label="Parent category"
          name="mainCategoryId"
          help="Leave as none to create a main category."
        >
          <CategorySelect
            v-model="state.mainCategoryId"
            type="MAIN"
            :exclude-id="category?.id"
            none-label="None (main category)"
          />
        </UFormField>

        <UFormField
          label="Status"
          name="status"
          required
        >
          <USelect
            v-model="state.status"
            :items="STATUS_ITEMS"
            class="w-full"
          />
        </UFormField>
      </UForm>
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-end gap-2">
        <span
          v-if="saving"
          class="mr-auto text-xs text-muted"
        >
          You can close this; saving continues in the background.
        </span>
        <UButton
          :label="saving ? 'Close' : 'Cancel'"
          color="neutral"
          variant="outline"
          @click="unsaved.requestClose()"
        />
        <UButton
          type="submit"
          form="category-form"
          :label="isEdit ? 'Save' : 'Create'"
          :loading="saving"
        />
      </div>
    </template>
  </UModal>
</template>
