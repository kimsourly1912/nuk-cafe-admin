<script setup lang="ts">
/**
 * Nuxt UI's `UDrawer` without dragging (owner, 2026-10-02; ui.md → Overlays): no handle, and the
 * sheet can't be dragged from anywhere, so scrolling its content or tapping a stepper never moves
 * or closes it. It closes with its X, a tap outside, Escape or Back: a phone's Back or edge swipe
 * closes it and stays on the page (D201). Use it for every drawer and bottom sheet; `UDrawer`
 * itself is a lint error outside this file.
 *
 * Every prop, event and slot is `UDrawer`'s; `close` (the header's X) is on unless set to `false`.
 * `routed` and `@back` are `<AppModal>`'s.
 */
import type { DrawerProps } from '@nuxt/ui'
import { UDrawer } from '#components'

defineOptions({ inheritAttrs: false })
const attrs = useAttrs()
const { close = true, ui, dismissible = true, routed = false, onBack } = defineProps<{
  close?: DrawerProps['close']
  ui?: DrawerProps['ui']
  dismissible?: boolean
  routed?: boolean
  onBack?: () => void
}>()
const open = defineModel<boolean>('open', { default: false })

useOverlayBack(() => open.value && !routed, () => {
  if (onBack) onBack()
  else if (dismissible) open.value = false
})

// The header and footer get their own padding and rule, so a scrolling body never runs into them.
// A consumer's `ui.header` / `ui.footer` is merged in, not replaced. The body scrolls with a thin
// scrollbar unless a consumer sets its own `ui.body` (the layout hides it on purpose).
const drawerUi = computed<DrawerProps['ui']>(() => ({
  ...ui,
  header: ['pb-3 border-b border-default', ui?.header].filter(Boolean).join(' '),
  footer: ['pt-3 border-t border-default', ui?.footer].filter(Boolean).join(' '),
}))
</script>

<template>
  <UDrawer
    v-bind="attrs"
    v-model:open="open"
    :dismissible="dismissible"
    :close="close"
    :handle="false"
    handle-only
    :ui="drawerUi"
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
  </UDrawer>
</template>
