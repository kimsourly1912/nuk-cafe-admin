<script setup lang="ts">
/**
 * Create/edit a menu item in a slide-over. Open via `useOverlay().create(ProductFormSlideover)`
 * with `itemId` (it loads the whole item: the list has summaries) or nothing for a new one; emits
 * `close(true)` when saved.
 *
 * The API saves the item, its option sets and price grid, add-ons and availability rules under one
 * `version` (D60, D61), so the form sends everything at once, from the version it loaded. Like the
 * other forms it stays open while saving but can be closed: the save continues, and a failure
 * offers "Reopen" with the input restored. A refused save also shows inside the panel, because
 * toasts can't be reached while it's open (D67, D68). An archived item is shown read-only.
 */
import type { DropdownMenuItem, FormSubmitEvent } from '@nuxt/ui'
import type { MenuItem } from '#shared/contracts/menu-items'
import { MAX_ITEM_OPTION_SETS } from '#shared/contracts/menu-items'
import { AvailabilityRuleSelect } from '~/features/availability-rules'
import { CategorySelect } from '~/features/categories'
import { useModifierGroupOptions } from '~/features/modifier-groups'
import { useOptionSetOptions } from '~/features/option-sets'
import { useItem, useItemMutations } from '../composables/useItems'
import { buildGrid, itemFormSchema, optionSetFromLibrary, toCreateItemBody, toItemForm, toUpdateItemBody } from '../schemas/item-form'
import type { FormOptionSet, ItemForm } from '../schemas/item-form'
import { ITEM_STATUS_LABELS } from '../utils/item-display'
import ItemAddOnGroups from './ItemAddOnGroups.vue'
import ItemPriceGrid from './ItemPriceGrid.vue'
import ProductFormSlideover from './ProductFormSlideover.vue'
import ProductImageInput from './ProductImageInput.vue'

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

const isEdit = props.itemId !== undefined || props.item !== undefined
const itemQuery = props.itemId && !props.item ? useItem(props.itemId) : undefined
/** The item as loaded when the form opened: its `version` is what the save names. */
const loaded = shallowRef<MenuItem | undefined>(props.item)
const ready = computed(() => !isEdit || loaded.value !== undefined)
const archived = computed(() => loaded.value?.status === 'archived')

const { data: optionSets, error: optionSetsError, refresh: refreshOptionSets } = useOptionSetOptions()
const { data: addOnLibrary } = useModifierGroupOptions()

const state = reactive<ItemForm>(cloneFormValue(props.draft ?? toItemForm(props.item, addOnLibrary.value)))

const { create, update } = useItemMutations()
const saving = ref(false)
const uploading = ref(false)

// Compared with the item as read (not the draft), so a reopened draft counts as unsaved.
const unsaved = useModalUnsavedChanges(state, {
  initial: toItemForm(props.item, addOnLibrary.value),
  paused: saving,
  close: () => emit('close', false),
})

// Editing: fill the form once, when the item arrives. Later refetches don't touch it: the form
// keeps the version it was opened with (a stale one is refused with 409).
if (itemQuery) {
  watch(() => itemQuery.data.value, (item) => {
    if (!item || loaded.value) return
    loaded.value = item
    Object.assign(state, cloneFormValue(toItemForm(item, addOnLibrary.value)))
    unsaved.markClean()
  }, { immediate: true })
}

// --- Option sets: changing them rebuilds the grid, keeping the prices of the same combinations ---
function setOptionSets(sets: FormOptionSet[]) {
  state.optionSets = sets
  state.grid = buildGrid(sets, state.grid, true)
}

const addSetItems = computed<DropdownMenuItem[]>(() => optionSets.value
  .filter(set => set.status === 'active' && !state.optionSets.some(chosen => chosen.id === set.id))
  .map(set => ({ label: set.name, onSelect: () => setOptionSets([...state.optionSets, optionSetFromLibrary(set)]) })))
const canAddSet = computed(() => state.optionSets.length < MAX_ITEM_OPTION_SETS && addSetItems.value.length > 0)

// --- Save ---
const form = useTemplateRef('form')
useSubmitShortcut(() => form.value?.submit())

/** The last refused save, shown in the panel (its toast is out of reach while the panel is open). */
const lastError = ref<string>()

/** Server field names → the form's, so a refused field shows its message where it's edited. */
function showServerErrors(fieldErrors: Record<string, string[]> | undefined) {
  const errors = Object.entries(fieldErrors ?? {}).flatMap(([field, messages]) => {
    const name = field
      .replace(/^variations\.(\d+)\.priceMinor$/, 'grid.$1.price')
      .replace(/^variations$/, 'grid')
      .replace(/^modifierGroups\.(\d+)\.rules\.(minSelect|maxSelect)$/, 'addOnGroups.$1.$2')
    return messages[0] ? [{ name, message: messages[0] }] : []
  })
  form.value?.setErrors(errors)
}

// If the user closes the panel mid-save, a failure offers to reopen it with their input.
let closed = false
onUnmounted(() => {
  closed = true
})
const overlay = useOverlay()
function reopenActions(draft: ItemForm) {
  if (!closed) return []
  return [{
    label: 'Reopen',
    onClick: () => overlay.create(ProductFormSlideover, { destroyOnClose: true }).open({ item: loaded.value, draft }),
  }]
}

async function onSubmit(_event: FormSubmitEvent<unknown>) {
  if (uploading.value || archived.value) return
  const draft = cloneFormValue(state)
  const overrides = { errorActions: () => reopenActions(draft) }

  lastError.value = undefined
  saving.value = true
  const result = loaded.value
    ? await update.execute({ id: loaded.value.id, name: draft.name.trim(), body: toUpdateItemBody(draft, loaded.value) }, overrides)
    : await create.execute(toCreateItemBody(draft), overrides)
  saving.value = false

  if (!result.ok) {
    if (result.status === 'error') {
      lastError.value = result.error.code === 'VERSION_CONFLICT'
        ? 'Someone else changed this menu item. Close it and open it again to see their changes (your input will be lost).'
        : result.error.message
      showServerErrors(result.error.fieldErrors)
    }
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
      <UForm
        v-else
        id="product-form"
        ref="form"
        :schema="itemFormSchema"
        :state="state"
        :validate-on="['input', 'change']"
        :disabled="saving || archived"
        class="space-y-6"
        @submit="onSubmit"
      >
        <UAlert
          v-if="archived"
          color="neutral"
          variant="subtle"
          icon="i-lucide-archive"
          title="This menu item is archived. Restore it from the list to edit it."
        />
        <UAlert
          v-if="lastError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Not saved"
          :description="lastError"
        />

        <UFormField
          label="Image"
          name="imageId"
        >
          <ProductImageInput
            v-model:image-url="state.imageUrl"
            v-model:image-id="state.imageId"
            v-model:uploading="uploading"
            :disabled="saving || archived"
          />
        </UFormField>

        <div class="grid gap-4 sm:grid-cols-2">
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
            label="Category"
            name="categoryId"
            required
          >
            <CategorySelect
              v-model="state.categoryId"
              level="leaf"
              aria-label="Category"
            />
          </UFormField>
        </div>

        <UFormField
          label="Description"
          name="description"
        >
          <UTextarea
            v-model="state.description"
            :rows="2"
            autoresize
            class="w-full"
          />
        </UFormField>

        <section
          aria-label="Options and prices"
          class="space-y-3"
        >
          <div>
            <h3 class="font-medium text-highlighted">
              Options and prices
            </h3>
            <p class="text-sm text-muted">
              Up to {{ MAX_ITEM_OPTION_SETS }} option sets from the Options library, e.g. size and temperature. Each combination is a version with its own price; switch off the ones you don't sell.
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <UBadge
              v-for="set in state.optionSets"
              :key="set.id"
              color="neutral"
              variant="outline"
              size="lg"
            >
              {{ set.name }}{{ set.status === 'archived' ? ' (archived)' : '' }}
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="link"
                size="xs"
                :aria-label="`Remove option set ${set.name}`"
                :disabled="saving || archived"
                @click="setOptionSets(state.optionSets.filter(s => s.id !== set.id))"
              />
            </UBadge>
            <ApiErrorAlert
              v-if="optionSetsError"
              :error="optionSetsError"
              title="Could not load the Options library"
              @retry="refreshOptionSets()"
            />
            <UDropdownMenu
              v-else
              :items="addSetItems"
              :disabled="saving || archived || !canAddSet"
            >
              <UButton
                label="Add option set"
                icon="i-lucide-plus"
                color="neutral"
                variant="outline"
                size="sm"
                :disabled="saving || archived || !canAddSet"
              />
            </UDropdownMenu>
          </div>
          <ItemPriceGrid
            v-model="state.grid"
            :sets="state.optionSets"
            :disabled="saving || archived"
          />
        </section>

        <section
          aria-label="Add-ons"
          class="space-y-3"
        >
          <h3 class="font-medium text-highlighted">
            Add-ons
          </h3>
          <ItemAddOnGroups
            v-model="state.addOnGroups"
            :disabled="saving || archived"
          />
        </section>

        <UFormField
          label="Availability"
          name="availabilityRuleIds"
          description="When it's sold. None: whenever the branch is open. Its category's rules apply too."
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
