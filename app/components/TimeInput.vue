<script setup lang="ts">
/**
 * Nuxt UI's `UInputTime` with AM/PM changed by a tap or click. Reka changes the AM/PM segment only
 * from the keyboard (A, P or the arrows), and a phone's keyboard sends neither: Android's reports
 * every letter as "Unidentified", so on a phone AM/PM couldn't be changed at all. Tapping it now
 * switches between AM and PM; the keys still work.
 *
 * Every other prop, event and slot is `UInputTime`'s. Use it for every time of day.
 */
import type { Time } from '@internationalized/date'
import { UInputTime } from '#components'

defineOptions({ inheritAttrs: false })
const attrs = useAttrs()
const props = defineProps<{ modelValue?: Time | null, disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: Time | undefined] }>()

function onUpdate(value: unknown) {
  emit('update:modelValue', (value ?? undefined) as Time | undefined)
}

/** A tap on AM/PM moves the time by 12 hours (7:00 AM ↔ 7:00 PM). Nothing while empty. */
function onClick(event: MouseEvent) {
  if (props.disabled || !props.modelValue) return
  const segment = (event.target as Element | null)?.closest('[data-reka-time-field-segment="dayPeriod"]')
  if (!segment) return
  emit('update:modelValue', props.modelValue.set({ hour: (props.modelValue.hour + 12) % 24 }))
}
</script>

<template>
  <UInputTime
    v-bind="attrs"
    :model-value="modelValue ?? undefined"
    :disabled="disabled"
    @update:model-value="onUpdate"
    @click="onClick"
  >
    <template
      v-for="(_, name) in $slots"
      #[name]="slotProps"
    >
      <slot
        :name="name"
        v-bind="slotProps ?? {}"
      />
    </template>
  </UInputTime>
</template>
