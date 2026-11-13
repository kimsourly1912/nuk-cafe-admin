<script setup lang="ts">
import { evaluateNumber } from '../designer/expression'

/**
 * A number in Studio's panels (ISS-020, like Figma's fields). It sends a value only when one is
 * committed, so each commit is one undo step:
 * - typed, plain or with math (`900+25`, `(600-40)/2`): Enter or leaving the field commits; Escape
 *   puts back what it showed and leaves; anything that isn't a number is put back too;
 * - the arrow keys add or take 1, 10 with Shift (owner, 2026-11-13: Figma's steps);
 * - dragging the handle at its left scrubs the value (1 per pixel, 10 with Shift), committed when
 *   the pointer is let go.
 * A value outside `min`–`max` is kept inside, and a message says so instead of a silent jump.
 */
const { min, max, disabled = false, label = 'The value', unit = '' } = defineProps<{
  min: number
  max: number
  disabled?: boolean
  /** For the messages and the scrub handle's name: "Width", "X". */
  label?: string
  unit?: string
}>()
const value = defineModel<number>({ required: true })
const toast = useToast()

const text = ref(String(value.value))
const editing = ref(false)
watch(value, (next) => {
  if (!editing.value) text.value = String(next)
})

function clamped(next: number): number {
  const whole = Math.round(next)
  const kept = Math.min(max, Math.max(min, whole))
  if (kept !== whole) toast.add({ title: 'Kept within limits', description: `${label} is ${min} to ${max}${unit ? ` ${unit}` : ''}.`, color: 'neutral', icon: 'i-lucide-info' })
  return kept
}

function commit(next: number) {
  const kept = clamped(next)
  text.value = String(kept)
  if (kept !== value.value) value.value = kept
  // The page may keep another value (450° is kept as 90°): show what it kept.
  void nextTick(() => {
    if (!editing.value) text.value = String(value.value)
  })
}

function commitText() {
  editing.value = false
  const typed = evaluateNumber(text.value)
  if (typed === null) {
    text.value = String(value.value)
    return
  }
  commit(typed)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    commitText()
    return
  }
  if (event.key === 'Escape') {
    // Studio's own Escape does nothing here: the field only lets go.
    event.preventDefault()
    event.stopPropagation()
    editing.value = false
    text.value = String(value.value)
    ;(event.target as HTMLInputElement).blur()
    return
  }
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault()
    const from = evaluateNumber(text.value) ?? value.value
    commit(from + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 10 : 1))
  }
}

// Scrubbing (Figma's drag on a field's label): live in the field, one commit on release.
let scrub: { pointerId: number, startX: number, from: number } | null = null
function onScrubDown(event: PointerEvent) {
  if (disabled || event.button !== 0) return
  event.preventDefault()
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  scrub = { pointerId: event.pointerId, startX: event.clientX, from: value.value }
}
function onScrubMove(event: PointerEvent) {
  if (scrub?.pointerId !== event.pointerId) return
  const moved = Math.round(event.clientX - scrub.startX) * (event.shiftKey ? 10 : 1)
  text.value = String(Math.min(max, Math.max(min, scrub.from + moved)))
}
function onScrubUp(event: PointerEvent) {
  if (scrub?.pointerId !== event.pointerId) return
  scrub = null
  const next = Number(text.value)
  if (Number.isFinite(next) && next !== value.value) value.value = next
}
</script>

<template>
  <UInput
    v-model="text"
    inputmode="decimal"
    autocomplete="off"
    :disabled="disabled"
    @focus="editing = true"
    @update:model-value="editing = true"
    @blur="commitText"
    @keydown="onKeydown"
  >
    <template #leading>
      <span
        role="presentation"
        :title="`Drag to change ${label.toLowerCase()}`"
        class="flex touch-none items-center text-dimmed"
        :class="disabled ? 'cursor-not-allowed' : 'cursor-ew-resize hover:text-toned'"
        data-testid="number-scrub"
        @pointerdown="onScrubDown"
        @pointermove="onScrubMove"
        @pointerup="onScrubUp"
        @pointercancel="onScrubUp"
      >
        <UIcon
          name="i-lucide-chevrons-left-right"
          class="size-3.5"
        />
      </span>
    </template>
  </UInput>
</template>
