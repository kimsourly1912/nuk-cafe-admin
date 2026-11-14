<script setup lang="ts">
/**
 * One finish slot's choice (D285, owner D2 "free colours, for everything"): the palette's
 * suggestions as swatches, then Custom colour, which opens a colour picker. A colour is applied
 * with its button, once, so dragging the picker is not a change per step (one undo step in Studio).
 * Used by Studio's inspector, the table look form and the piece look form; walls, floor surfaces and
 * doors use it with no suggestions.
 */
import { isFinishColor } from '#shared/contracts/shop-layout'
import type { Finish, FinishKey } from '#shared/contracts/shop-layout'
import { FINISH_SWATCHES, finishColor, finishSwatch } from '../designer/catalog'

const props = withDefaults(defineProps<{
  label: string
  /** The current finish, the slot's default included; left out: none picked (a wall's own plaster). */
  modelValue?: Finish
  /** Where the colour picker starts when nothing is picked. */
  startColor?: string
  options?: readonly FinishKey[]
  /** Names the value instead of its swatch's name (a wall's "Plaster" before a colour is picked). */
  valueLabel?: string
  /** Studio's inspector: round swatches, a stronger label; the forms' are square and larger. */
  round?: boolean
  disabled?: boolean
}>(), { modelValue: undefined, startColor: '#ffffff', options: () => [], valueLabel: undefined, round: false, disabled: false })
const emit = defineEmits<{ 'update:modelValue': [finish: Finish] }>()

/** The colour picked, when the value is one of the owner's own. */
const customColor = computed(() => (props.modelValue !== undefined && isFinishColor(props.modelValue) ? props.modelValue : undefined))
const custom = computed(() => customColor.value !== undefined)
const name = computed(() => props.valueLabel ?? (props.modelValue === undefined ? '' : finishSwatch(props.modelValue, 'wood').label))
const open = ref(false)
const draft = ref('#ffffff')
const typed = ref('')
watch(open, (isOpen) => {
  if (!isOpen) return
  draft.value = props.modelValue === undefined ? props.startColor : finishColor(props.modelValue)
  typed.value = draft.value
})

/** What was typed, as a contract colour (`#` and six lowercase hex digits), or undefined. */
function normalised(value: string): Finish | undefined {
  const hex = value.trim().toLowerCase().replace(/^#?/, '#')
  return isFinishColor(hex) ? hex : undefined
}
const typedColor = computed(() => normalised(typed.value))

function pick(value: string | undefined) {
  const color = value && normalised(value)
  if (!color) return
  draft.value = color
  typed.value = color
}

function apply() {
  const color = typedColor.value
  if (!color) return
  open.value = false
  if (color !== props.modelValue) emit('update:modelValue', color)
}

const swatchClass = computed(() => [
  props.round ? 'size-8 rounded-full' : 'size-9 rounded-md',
  'border border-default ring-offset-2 ring-offset-(--ui-bg) focus-visible:outline-2 focus-visible:outline-primary aria-pressed:ring-2 aria-pressed:ring-primary disabled:opacity-50',
])
</script>

<template>
  <div
    class="flex flex-col gap-1.5"
    role="group"
    :aria-label="label"
  >
    <p :class="round ? 'text-sm font-medium text-highlighted' : 'text-sm text-toned'">
      {{ label }} <span :class="round ? 'font-normal text-muted' : 'text-muted'">· {{ name }}</span>
    </p>
    <div class="flex flex-wrap gap-2">
      <button
        v-for="option in options"
        :key="option"
        type="button"
        :class="swatchClass"
        :style="{ background: FINISH_SWATCHES[option].color }"
        :aria-label="FINISH_SWATCHES[option].label"
        :aria-pressed="modelValue === option"
        :disabled="disabled"
        @click="emit('update:modelValue', option)"
      />
      <UPopover
        v-model:open="open"
        :content="{ align: 'start' }"
      >
        <button
          type="button"
          :class="swatchClass"
          class="grid place-items-center"
          :style="{ background: customColor ?? 'conic-gradient(#e5484d, #f5d90a, #46a758, #0090ff, #8e4ec6, #e5484d)' }"
          :aria-label="custom ? `Custom colour ${name}` : 'Custom colour'"
          :aria-pressed="custom"
          :disabled="disabled"
          :data-testid="`finish-custom-${label}`"
        >
          <UIcon
            v-if="!custom"
            name="i-lucide-plus"
            class="size-4 rounded-full bg-default/80 text-highlighted"
          />
        </button>
        <template #content>
          <form
            class="flex w-60 flex-col gap-3 p-3"
            :aria-label="`${label}: custom colour`"
            @submit.prevent="apply()"
          >
            <UColorPicker
              :model-value="draft"
              format="hex"
              class="self-center"
              @update:model-value="pick"
            />
            <UFormField
              label="Hex"
              :error="typed && !typedColor ? 'Six hex digits, like #a0522d' : undefined"
            >
              <UInput
                v-model="typed"
                class="w-full font-mono"
                maxlength="7"
                autocomplete="off"
                spellcheck="false"
              />
            </UFormField>
            <div class="flex justify-end gap-2">
              <UButton
                label="Cancel"
                color="neutral"
                variant="outline"
                size="sm"
                @click="open = false"
              />
              <UButton
                type="submit"
                label="Use colour"
                size="sm"
                :disabled="!typedColor"
              />
            </div>
          </form>
        </template>
      </UPopover>
    </div>
  </div>
</template>
