<script setup lang="ts">
/**
 * Create/edit form. Open via `useOverlay().create(CategoryFormModal)`; emits `close(true)` when saved.
 *
 * The modal stays open while saving so backend errors can be fixed in place, but the user may
 * close it: the save continues, and if it then fails the error toast offers "Reopen" with the
 * user's input restored.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import type { Category } from '#shared/contracts/menu'
import { useCategoryMutations } from '../composables/useCategories'
import { categoryFormSchema, toCategoryForm, toCreateCategoryBody, toUpdateCategoryBody } from '../schemas/category-form'
import type { CategoryForm } from '../schemas/category-form'
import CategoryFormModal from './CategoryFormModal.vue'
import CategorySelect from './CategorySelect.vue'

const props = defineProps<{
  /** Omit to create a new category. */
  category?: Category
  /** Restores unsaved input (used by "Reopen" after a failed background save). */
  draft?: CategoryForm
  /** New sub-category of this main category ("Add sub-category" in the tree). */
  parentId?: string
}>()

// `update:open` is declared so closing (X, Esc, outside click) goes through `unsaved` instead of
// straight to the overlay.
const emit = defineEmits<{ 'close': [saved: boolean], 'update:open': [open: boolean] }>()

const isEdit = computed(() => props.category !== undefined)
/** The form's starting values; a preset parent is part of them, so it doesn't count as a change. */
const start = (): CategoryForm => ({ ...toCategoryForm(props.category), ...(props.parentId === undefined ? {} : { parentId: props.parentId }) })
const state = reactive<CategoryForm>({ ...(props.draft ?? start()) })

const { create, update } = useCategoryMutations()
const saving = ref(false)

// Compared with the form's original values (not the draft), so a reopened draft counts as unsaved.
const unsaved = useModalUnsavedChanges(state, {
  initial: start(),
  paused: saving,
  close: () => emit('close', false),
})

const form = useTemplateRef('form')
useSubmitShortcut(() => form.value?.submit())

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
    onClick: () => overlay.create(CategoryFormModal, { destroyOnClose: true }).open({ category: props.category, parentId: props.parentId, draft }),
  }]
}

async function onSubmit({ data }: FormSubmitEvent<CategoryForm>) {
  const draft = { ...state }
  const overrides = { errorActions: () => reopenActions(draft) }

  saving.value = true
  const result = props.category
    ? await update.execute({ id: props.category.id, name: data.name, body: toUpdateCategoryBody(data, props.category) }, overrides)
    : await create.execute(toCreateCategoryBody(data), overrides)
  saving.value = false

  if (!result.ok) return
  unsaved.markClean()
  emit('close', true)
}
</script>

<template>
  <UModal
    :title="isEdit ? 'Edit category' : parentId === undefined ? 'New category' : 'New sub-category'"
    @update:open="unsaved.onOpenChange"
  >
    <template #body>
      <UForm
        id="category-form"
        ref="form"
        :schema="categoryFormSchema"
        :state="state"
        :validate-on="['input', 'change']"
        :disabled="saving"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField
          label="Name"
          name="name"
          required
        >
          <UInput
            v-model="state.name"
            class="w-full"
            autofocus
          />
        </UFormField>

        <UFormField
          label="Parent category"
          name="parentId"
          help="Leave as none to create a main category."
        >
          <CategorySelect
            v-model="state.parentId"
            level="main"
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
        <UTooltip
          :text="isEdit ? 'Save' : 'Create'"
          :kbds="['meta', 'enter']"
        >
          <UButton
            type="submit"
            form="category-form"
            :label="isEdit ? 'Save' : 'Create'"
            :loading="saving"
          />
        </UTooltip>
      </div>
    </template>
  </UModal>
</template>
