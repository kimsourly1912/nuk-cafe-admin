<script setup lang="ts">
/** Create/edit form. Open via `useOverlay().create(CategoryFormModal)`; emits `close(true)` when saved. */
import type { FormSubmitEvent } from '@nuxt/ui'
import type { CategoryResponse } from '~/generated/api'
import { useCategoryMutations } from '../composables/useCategories'
import { categoryFormSchema, toCategoryForm, toCategoryRequest } from '../schemas/category-form'
import type { CategoryForm } from '../schemas/category-form'
import CategorySelect from './CategorySelect.vue'

const props = defineProps<{
  /** Omit to create a new category. */
  category?: CategoryResponse
}>()

const emit = defineEmits<{ close: [saved: boolean] }>()

const isEdit = computed(() => props.category?.id !== undefined)
const state = reactive(toCategoryForm(props.category))

const { create, update } = useCategoryMutations()
const toast = useToast()
const saving = ref(false)

async function onSubmit({ data }: FormSubmitEvent<CategoryForm>) {
  const body = toCategoryRequest(data, props.category)
  saving.value = true
  try {
    if (isEdit.value) await update(props.category!.id!, body)
    else await create(body)
    toast.add({ title: isEdit.value ? 'Category updated' : 'Category created', color: 'success' })
    emit('close', true)
  }
  catch (error) {
    toast.add({ title: 'Could not save category', description: getErrorMessage(error), color: 'error' })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    :title="isEdit ? 'Edit category' : 'New category'"
    :dismissible="!saving"
  >
    <template #body>
      <UForm
        id="category-form"
        :schema="categoryFormSchema"
        :state="state"
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
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="outline"
          :disabled="saving"
          @click="emit('close', false)"
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
