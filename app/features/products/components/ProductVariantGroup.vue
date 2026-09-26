<script setup lang="ts">
/**
 * One variant group ("Choose your drink") and its options, inside `ProductVariantsEditor`.
 * Options reorder by dragging their handle, or with ↑/↓ while the handle has focus.
 */
import { useSortable } from '@vueuse/integrations/useSortable'
import type { VariantForm } from '../schemas/product-form'
import { newOption } from '../schemas/product-form'
import { PRICE_FORMAT } from '../utils/money'

const props = defineProps<{
  /** Position in the list: for the form field names (`variants.0.variantName`) and labels. */
  index: number
  disabled?: boolean
}>()

const variant = defineModel<VariantForm>('variant', { required: true })
const emit = defineEmits<{ 'remove': [], 'handle-keydown': [event: KeyboardEvent] }>()

const field = (path: string) => `variants.${props.index}.${path}`
const groupLabel = computed(() => variant.value.variantName || `group ${props.index + 1}`)

// --- Options: drag and drop + keyboard ---
const optionsEl = useTemplateRef<HTMLElement>('optionsEl')
const options = toRef(variant.value, 'options')
const sortable = useSortable(optionsEl, options, { handle: '[data-option-handle]', animation: 150, watchElement: true })
watch(() => props.disabled, disabled => sortable.option('disabled', !!disabled), { immediate: true })

async function moveOption(from: number, delta: number) {
  const to = from + delta
  const list = variant.value.options
  if (to < 0 || to >= list.length) return
  const [moved] = list.splice(from, 1)
  list.splice(to, 0, moved!)
  // Moving a DOM node drops its focus: give it back so ↑/↓ can be pressed again.
  await nextTick()
  optionsEl.value?.querySelector<HTMLElement>(`[data-option-handle="${moved!.key}"]`)?.focus()
}

function onOptionHandleKey(event: KeyboardEvent, index: number) {
  if (event.key === 'ArrowUp') moveOption(index, -1)
  else if (event.key === 'ArrowDown') moveOption(index, 1)
  else return
  event.preventDefault()
}

function addOption() {
  variant.value.options.push(newOption())
}

function removeOption(index: number) {
  variant.value.options.splice(index, 1)
}
</script>

<template>
  <div class="space-y-3 rounded-md border border-default p-3">
    <div class="flex items-start gap-2">
      <UButton
        icon="i-lucide-grip-vertical"
        color="neutral"
        variant="ghost"
        size="sm"
        class="mt-0.5 cursor-grab"
        :data-group-handle="variant.key"
        :aria-label="`Reorder ${groupLabel} (drag, or press up or down)`"
        :disabled="disabled"
        @keydown="emit('handle-keydown', $event)"
      />
      <UFormField
        :name="field('variantName')"
        class="flex-1"
      >
        <UInput
          v-model="variant.variantName"
          placeholder="Group name, e.g. Choose your drink"
          :aria-label="`Name of group ${index + 1}`"
          class="w-full"
        />
      </UFormField>
      <UButton
        icon="i-lucide-trash-2"
        color="error"
        variant="ghost"
        size="sm"
        class="mt-0.5"
        :aria-label="`Remove ${groupLabel}`"
        :disabled="disabled"
        @click="emit('remove')"
      />
    </div>

    <div class="flex flex-wrap gap-x-6 gap-y-2 pl-10">
      <USwitch
        v-model="variant.requiredSelection"
        label="Required"
      />
      <USwitch
        v-model="variant.allowMultipleSelection"
        label="Customers can pick several"
      />
    </div>

    <UFormField
      :name="field('options')"
      class="pl-10"
    >
      <div
        ref="optionsEl"
        class="space-y-2"
      >
        <div
          v-for="(option, i) in variant.options"
          :key="option.key"
          class="flex items-start gap-2"
        >
          <UButton
            icon="i-lucide-grip-vertical"
            color="neutral"
            variant="ghost"
            size="xs"
            class="mt-1 cursor-grab"
            :data-option-handle="option.key"
            :aria-label="`Reorder option ${option.optionName || i + 1} (drag, or press up or down)`"
            :disabled="disabled"
            @keydown="onOptionHandleKey($event, i)"
          />
          <UFormField
            :name="field(`options.${i}.optionName`)"
            class="flex-1"
          >
            <UInput
              v-model="option.optionName"
              placeholder="Option, e.g. Iced tea"
              :aria-label="`Name of option ${i + 1} in ${groupLabel}`"
              class="w-full"
            />
          </UFormField>
          <UFormField
            :name="field(`options.${i}.price`)"
            class="w-32"
          >
            <UInputNumber
              :model-value="option.price ?? null"
              :format-options="PRICE_FORMAT"
              :min="0"
              :step="0.01"
              :aria-label="`Extra price of option ${i + 1} in ${groupLabel}`"
              class="w-full"
              @update:model-value="value => (option.price = value ?? undefined)"
            />
          </UFormField>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="xs"
            class="mt-1"
            :aria-label="`Remove option ${option.optionName || i + 1}`"
            :disabled="disabled"
            @click="removeOption(i)"
          />
        </div>
      </div>
      <UButton
        label="Add option"
        icon="i-lucide-plus"
        variant="link"
        size="xs"
        class="mt-1 px-0"
        :disabled="disabled"
        @click="addOption"
      />
    </UFormField>
  </div>
</template>
