<script setup lang="ts">
/**
 * Create/edit form. Open via `useOverlay().create(CategoryFormModal)`; emits `close(true)` when saved.
 *
 * The modal stays open while saving so backend errors can be fixed in place, but the user may
 * close it: the save continues, and if it then fails the error toast offers "Reopen" with the
 * user's input restored. A refused save also shows inside the modal (toasts are out of reach while
 * it's open); after a version conflict, Reload takes the latest version and keeps the input (D72).
 * Full screen on small screens.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import type { MenuCategory } from '#shared/contracts/menu-categories'
import { useMediaQuery } from '@vueuse/core'
import { AvailabilityRuleSelect } from '~/features/availability-rules'
import { useCategoryMutations } from '../composables/useCategories'
import { useAllCategories } from '../composables/useCategoryOptions'
import { categoryFormSchema, toCategoryForm, toCreateCategoryBody, toUpdateCategoryBody } from '../schemas/category-form'
import type { CategoryForm } from '../schemas/category-form'
import CategoryFormModal from './CategoryFormModal.vue'
import CategorySelect from './CategorySelect.vue'

const props = defineProps<{
  /** Omit to create a new category. */
  category?: MenuCategory
  /** Restores unsaved input (used by "Reopen" after a failed background save). */
  draft?: CategoryForm
  /** New subcategory of this top-level category ("Add subcategory" in the tree). */
  parentId?: string
}>()

// `update:open` is declared so closing (X, Esc, outside click) goes through `unsaved` instead of
// straight to the overlay.
const emit = defineEmits<{ 'close': [saved: boolean], 'update:open': [open: boolean] }>()

const isEdit = computed(() => props.category !== undefined)
/** The form's starting values; a preset parent is part of them, so it doesn't count as a change. */
const start = (): CategoryForm => ({ ...toCategoryForm(props.category), ...(props.parentId === undefined ? {} : { parentId: props.parentId }) })
const copy = (form: CategoryForm): CategoryForm => ({ ...form, availabilityRuleIds: [...form.availabilityRuleIds] })
const state = reactive<CategoryForm>(copy(props.draft ?? start()))
/** The category as last read: its `version` is what a save names (Reload after a conflict updates it). */
const base = shallowRef(props.category)
/** A category with subcategories stays top-level (two levels, D44): its parent can't change. */
const hasSubs = computed(() => (base.value?.childCount ?? 0) > 0)
const fullscreen = useMediaQuery('(max-width: 639px)')

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
    onClick: () => overlay.create(CategoryFormModal, { destroyOnClose: true }).open({ category: base.value, parentId: props.parentId, draft }),
  }]
}

/** The last refused save, shown in the modal; `conflict`: someone else saved first (409). */
const lastError = ref<{ message: string, conflict: boolean }>()
const all = useAllCategories()
const reloading = ref(false)

/** Takes the latest version of the category; the form keeps what the user typed. */
async function reload() {
  if (!base.value) return
  reloading.value = true
  await all.refresh()
  reloading.value = false
  const latest = all.data.value?.find(c => c.id === base.value!.id)
  if (!latest || latest.status !== 'active') {
    lastError.value = { message: 'This category was archived meanwhile. Close this form; restore it to edit it.', conflict: false }
    return
  }
  base.value = latest
  lastError.value = undefined
}

async function onSubmit({ data }: FormSubmitEvent<CategoryForm>) {
  const draft = copy(state)
  const overrides = { errorActions: () => reopenActions(draft) }

  lastError.value = undefined
  saving.value = true
  const result = base.value
    ? await update.execute({ id: base.value.id, name: data.name, body: toUpdateCategoryBody(data, base.value) }, overrides)
    : await create.execute(toCreateCategoryBody(data), overrides)
  saving.value = false

  if (!result.ok) {
    if (result.status === 'error') lastError.value = { message: result.error.message, conflict: result.error.code === 'VERSION_CONFLICT' }
    return
  }
  unsaved.markClean()
  emit('close', true)
}
</script>

<template>
  <UModal
    :title="isEdit ? 'Edit category' : parentId === undefined ? 'New category' : 'New subcategory'"
    :fullscreen="fullscreen"
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
        <UAlert
          v-if="lastError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Not saved"
          :description="lastError.conflict ? 'Someone else changed this category since you opened it. Reload to take the latest version: your input stays here, and saving then replaces their changes.' : lastError.message"
          :actions="lastError.conflict ? [{ label: 'Reload', color: 'neutral', variant: 'outline', loading: reloading, onClick: () => reload() }] : undefined"
        />
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
          label="Description"
          name="description"
          help="Shown to customers under the category name."
        >
          <UTextarea
            v-model="state.description"
            :rows="2"
            autoresize
            class="w-full"
          />
        </UFormField>

        <UFormField
          label="Parent category"
          name="parentId"
          :help="hasSubs ? 'It has subcategories, so it stays a top-level category.' : 'Leave as none for a top-level category. A category holds either subcategories or menu items.'"
        >
          <CategorySelect
            v-model="state.parentId"
            level="main"
            :exclude-id="category?.id"
            none-label="None (top-level category)"
            aria-label="Parent category"
            :disabled="hasSubs"
          />
        </UFormField>

        <UFormField
          label="Availability"
          name="availabilityRuleIds"
          help="Its menu items (and a top-level category's subcategories) are sold only during these times. None: always, or as its parent for a subcategory."
        >
          <AvailabilityRuleSelect
            v-model="state.availabilityRuleIds"
            aria-label="Availability"
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
