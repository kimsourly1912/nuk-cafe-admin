<script setup lang="ts">
/**
 * Nuxt UI's `USlideover` that Back closes (D201; ui.md → Overlays): a phone's Back or edge swipe
 * closes it like Escape and stays on the page. Use it for every slide-over; `USlideover` itself is
 * a lint error outside this file.
 *
 * Every prop, event and slot is `USlideover`'s, plus:
 * - `routed`: the page keeps this slide-over in its address (`?item=`), so Back is already a
 *   route change that closes it: no entry of its own.
 * - `@back`: what Back does instead. Without it, a slide-over that can't be dismissed stays open.
 */
import { USlideover } from '#components'

defineOptions({ inheritAttrs: false })
const { dismissible = true, routed = false, onBack } = defineProps<{
  dismissible?: boolean
  routed?: boolean
  onBack?: () => void
}>()
const open = defineModel<boolean>('open', { default: false })

useOverlayBack(() => open.value && !routed, () => {
  if (onBack) onBack()
  else if (dismissible) open.value = false
})
</script>

<template>
  <USlideover
    v-bind="$attrs"
    v-model:open="open"
    :dismissible="dismissible"
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
  </USlideover>
</template>
