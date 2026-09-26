<script setup lang="ts">
/**
 * Create/edit form in a slide-over. Open via `useOverlay().create(ProductFormSlideover)`; emits
 * `close(true)` when saved.
 *
 * Like the category form, it stays open while saving but can be closed: the save continues, and
 * a failure offers "Reopen" with the input restored. Save waits for a running image upload.
 * Variants are edited in `ProductVariantsEditor`. After a save, the server's reply is compared
 * with what was sent, and any difference is shown as a warning (the backend's handling of removed
 * variants is unverified, Q18, D35).
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import type { ProductResponse } from '~/generated/api'
import { CategorySelect } from '~/features/categories'
import { ScheduleSelect } from '~/features/schedules'
import { useProductMutations } from '../composables/useProducts'
import { productFormSchema, toProductForm, toProductRequest, variantMismatches } from '../schemas/product-form'
import type { ProductForm } from '../schemas/product-form'
import { PRICE_FORMAT } from '../utils/money'
import ProductFormSlideover from './ProductFormSlideover.vue'
import ProductImageInput from './ProductImageInput.vue'
import ProductVariantsEditor from './ProductVariantsEditor.vue'

const props = defineProps<{
  /** A list row. Omit to create a new menu item. */
  product?: ProductResponse
  /** Restores unsaved input (used by "Reopen" after a failed background save). */
  draft?: ProductForm
}>()

// `update:open` is declared so closing (X, Esc, outside click) goes through `unsaved` instead of
// straight to the overlay.
const emit = defineEmits<{ 'close': [saved: boolean], 'update:open': [open: boolean] }>()

const isEdit = props.product?.id !== undefined
// A deep copy that unwraps proxies (drag and drop can leave them inside the arrays).
const state = reactive<ProductForm>(cloneFormValue(props.draft ?? toProductForm(props.product)))

// UInputNumber clears to `null`; the form uses `undefined` for "no price".
const price = computed({
  get: () => state.price ?? null,
  set: (value: number | null | undefined) => {
    state.price = value ?? undefined
  },
})

const { create, update } = useProductMutations()
const saving = ref(false)
const uploading = ref(false)

// Compared with the original values (not the draft), so a reopened draft counts as unsaved.
const unsaved = useModalUnsavedChanges(state, {
  initial: toProductForm(props.product),
  paused: saving,
  close: () => emit('close', false),
})

const form = useTemplateRef('form')
useSubmitShortcut(() => form.value?.submit())

const notify = useNotify()

// If the user closes the panel mid-save, a failure offers to reopen it with their input.
let closed = false
onUnmounted(() => {
  closed = true
})
const overlay = useOverlay()
function reopenActions(draft: ProductForm) {
  if (!closed) return []
  return [{
    label: 'Reopen',
    onClick: () => overlay.create(ProductFormSlideover, { destroyOnClose: true }).open({ product: props.product, draft }),
  }]
}

async function onSubmit({ data }: FormSubmitEvent<ProductForm>) {
  if (uploading.value) return
  const body = toProductRequest(data, props.product)
  const draft = cloneFormValue(state)
  const overrides = { errorActions: () => reopenActions(draft) }

  saving.value = true
  const result = isEdit
    ? await update.execute({ id: props.product!.id!, body }, overrides)
    : await create.execute({ ...body, productName: body.productName!, categoryId: body.categoryId!, price: body.price! }, overrides)
  saving.value = false

  if (!result.ok) return
  unsaved.markClean()
  emit('close', true)

  const problems = variantMismatches(body.variants, result.data?.variants)
  if (problems.length) {
    notify.warning(
      `Check the variants of "${body.productName}"`,
      `The server saved them differently: ${problems.join('; ')}.`,
    )
  }
}
</script>

<template>
  <USlideover
    :title="isEdit ? 'Edit menu item' : 'New menu item'"
    :ui="{ content: 'max-w-xl' }"
    @update:open="unsaved.onOpenChange"
  >
    <template #body>
      <UForm
        id="product-form"
        ref="form"
        :schema="productFormSchema"
        :state="state"
        :validate-on="['input', 'change']"
        :disabled="saving"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField
          label="Image"
          name="imageUrl"
        >
          <ProductImageInput
            v-model:image-url="state.imageUrl"
            v-model:image-uuid="state.imageUuid"
            v-model:uploading="uploading"
            :disabled="saving"
          />
        </UFormField>

        <UFormField
          label="Name"
          name="productName"
          required
        >
          <UInput
            v-model="state.productName"
            class="w-full"
            autofocus
          />
        </UFormField>

        <div class="grid grid-cols-2 gap-4">
          <UFormField
            label="Category"
            name="categoryId"
            required
          >
            <CategorySelect
              v-model="state.categoryId"
              :current-label="product?.category?.categoryName"
            />
          </UFormField>
          <UFormField
            label="Price"
            name="price"
            required
          >
            <UInputNumber
              v-model="price"
              :format-options="PRICE_FORMAT"
              :min="0"
              :step="0.01"
              aria-label="Price"
              class="w-full"
            />
          </UFormField>
        </div>

        <UFormField
          label="Description"
          name="description"
        >
          <UTextarea
            v-model="state.description"
            :rows="3"
            autoresize
            class="w-full"
          />
        </UFormField>

        <UFormField
          label="Schedules"
          name="scheduleIds"
        >
          <ScheduleSelect v-model="state.scheduleIds" />
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

        <div class="space-y-2">
          <p class="text-sm font-medium">
            Variants
          </p>
          <ProductVariantsEditor
            v-model="state.variants"
            :disabled="saving"
          />
        </div>
      </UForm>
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
            form="product-form"
            :label="isEdit ? 'Save' : 'Create'"
            :loading="saving"
            :disabled="uploading"
          />
        </UTooltip>
      </div>
    </template>
  </USlideover>
</template>
