<script setup lang="ts">
/**
 * Variant groups of a menu item ("Choose your drink" → Cola, Tea +$0.50), with their options.
 * Groups and options are added, removed and reordered here; the order shown is the order saved
 * (the request has no sort field). Reorder by dragging a handle, or with ↑/↓ on a focused handle.
 *
 * The whole list is sent on save; removed rows are left out. Whether the backend really removes
 * them is unverified (Q18), so the form compares its reply afterwards (`variantMismatches`, D35).
 */
import { useSortable } from '@vueuse/integrations/useSortable'
import type { VariantForm } from '../schemas/product-form'
import { newVariant } from '../schemas/product-form'
import ProductVariantGroup from './ProductVariantGroup.vue'

const props = defineProps<{ disabled?: boolean }>()
const variants = defineModel<VariantForm[]>({ required: true })

const listEl = useTemplateRef<HTMLElement>('listEl')
const sortable = useSortable(listEl, variants, { handle: '[data-group-handle]', animation: 150, watchElement: true })
watch(() => props.disabled, disabled => sortable.option('disabled', !!disabled), { immediate: true })

async function move(from: number, delta: number) {
  const to = from + delta
  if (to < 0 || to >= variants.value.length) return
  const list = [...variants.value]
  const [moved] = list.splice(from, 1)
  list.splice(to, 0, moved!)
  variants.value = list
  // Moving a DOM node drops its focus: give it back so ↑/↓ can be pressed again.
  await nextTick()
  listEl.value?.querySelector<HTMLElement>(`[data-group-handle="${moved!.key}"]`)?.focus()
}

function onHandleKey(event: KeyboardEvent, index: number) {
  if (event.key === 'ArrowUp') move(index, -1)
  else if (event.key === 'ArrowDown') move(index, 1)
  else return
  event.preventDefault()
}

async function add() {
  const variant = newVariant()
  variants.value = [...variants.value, variant]
  await nextTick()
  listEl.value?.querySelector<HTMLInputElement>(`[data-group="${variant.key}"] input`)?.focus()
}

function remove(index: number) {
  variants.value = variants.value.filter((_, i) => i !== index)
}
</script>

<template>
  <div class="space-y-3">
    <p
      v-if="!variants.length"
      class="text-sm text-muted"
    >
      No variants. Add a group for choices like size, milk or a side.
    </p>
    <div
      ref="listEl"
      class="space-y-3"
    >
      <ProductVariantGroup
        v-for="(variant, i) in variants"
        :key="variant.key"
        v-model:variant="variants[i]!"
        :data-group="variant.key"
        :index="i"
        :disabled="disabled"
        @remove="remove(i)"
        @handle-keydown="onHandleKey($event, i)"
      />
    </div>
    <UButton
      label="Add variant group"
      icon="i-lucide-plus"
      color="neutral"
      variant="outline"
      size="sm"
      :disabled="disabled"
      @click="add"
    />
  </div>
</template>
