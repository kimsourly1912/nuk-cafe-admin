<script setup lang="ts">
/**
 * Reorder menu items (step 10.3, D117): choose a category, then drag its items (or use the arrows)
 * and Save order. Customers see a category's items in this order (the public menu sorts by it).
 * One request with every item's version: if someone changed an item meanwhile, the server refuses
 * and nothing moves; the dialog says so with Reload (latest order, the moves dropped). Full screen
 * on phones. Closing with unsaved moves asks first.
 */
import type { MenuItemSummary } from '#shared/contracts/menu-items'
import { CategorySelect } from '~/features/categories'
import { saveItemOrder, useCategoryItems } from '../composables/useItems'
import ProductReorderList from './ProductReorderList.vue'

const props = defineProps<{ categoryId?: string }>()
const emit = defineEmits<{ close: [saved: boolean] }>()

const { isCompact } = useLayoutContext()
const categoryId = ref<string | undefined>(props.categoryId)
const query = useCategoryItems(categoryId)

/** The order being edited; the loaded one until something moves. */
const order = ref<MenuItemSummary[]>([])
const moved = computed(() => order.value.some((item, i) => item.id !== query.data.value?.[i]?.id))

const saving = ref(false)
const error = ref<ApiError | null>(null)
const conflict = computed(() => error.value?.kind === 'conflict')
const unsaved = useModalUnsavedChanges(() => ({ order: order.value.map(item => item.id) }), { paused: saving, close: () => emit('close', false) })
// A loaded (or reloaded) order is the new baseline: only moves count as unsaved.
watch(() => query.data.value, async (items) => {
  order.value = [...(items ?? [])]
  await nextTick()
  unsaved.markClean()
}, { immediate: true })

function move(from: number, to: number) {
  const next = [...order.value]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item!)
  order.value = next
  error.value = null
}

async function save() {
  if (!categoryId.value || !moved.value) return
  saving.value = true
  error.value = null
  try {
    await saveItemOrder(categoryId.value, order.value)
    unsaved.markClean()
    useToast().add({ title: 'Order saved', description: 'Customers see these items in this order.', color: 'success', icon: 'i-lucide-circle-check' })
    emit('close', true)
  }
  catch (failure) {
    error.value = ApiError.from(failure)
  }
  finally {
    saving.value = false
  }
}

async function reload() {
  error.value = null
  await query.refresh()
}

watch(categoryId, () => {
  error.value = null
})
</script>

<template>
  <UModal
    title="Reorder menu items"
    description="Customers see a category's items in this order."
    :fullscreen="isCompact"
    :dismissible="!saving"
    @update:open="unsaved.onOpenChange"
  >
    <template #body>
      <div class="space-y-4">
        <UFormField
          label="Category"
          name="category"
        >
          <CategorySelect
            v-model="categoryId"
            level="leaf"
            aria-label="Category"
            class="w-full"
            :disabled="saving || moved"
          />
        </UFormField>
        <p
          v-if="moved"
          class="text-sm text-muted"
        >
          Save or close to choose another category.
        </p>

        <UAlert
          v-if="error"
          :color="conflict ? 'warning' : 'error'"
          variant="subtle"
          :icon="conflict ? 'i-lucide-refresh-cw' : 'i-lucide-circle-alert'"
          :title="conflict ? 'Someone changed these items meanwhile' : getErrorMessage(error)"
          :description="conflict ? 'Nothing was moved. Reload to see the latest order, then move them again.' : undefined"
          :actions="conflict ? [{ label: 'Reload', color: 'neutral', variant: 'outline', onClick: reload }] : undefined"
        />

        <p
          v-if="!categoryId"
          class="py-6 text-center text-sm text-muted"
        >
          Choose a category to arrange its items.
        </p>
        <ApiErrorAlert
          v-else-if="query.error.value && !query.data.value"
          :error="query.error.value"
          title="Couldn't load the items"
          @retry="query.refresh()"
        />
        <ListSkeleton
          v-else-if="query.pending.value && !query.data.value?.length"
          label="Loading the items…"
          :count="4"
        />
        <p
          v-else-if="!order.length"
          class="py-6 text-center text-sm text-muted"
        >
          This category has no menu items yet.
        </p>
        <p
          v-else-if="order.length === 1"
          class="py-6 text-center text-sm text-muted"
        >
          Only one item: nothing to arrange.
        </p>
        <template v-else>
          <p class="text-sm text-muted">
            Drag an item or use its arrows.
          </p>
          <ProductReorderList
            :items="order"
            :disabled="saving"
            @move="move"
          />
        </template>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <UButton
          label="Cancel"
          color="neutral"
          variant="outline"
          class="justify-center"
          :disabled="saving"
          @click="unsaved.requestClose()"
        />
        <UButton
          label="Save order"
          class="justify-center"
          :loading="saving"
          :disabled="!moved || conflict"
          @click="save"
        />
      </div>
    </template>
  </UModal>
</template>
