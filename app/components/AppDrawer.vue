<script setup lang="ts">
/**
 * Nuxt UI's `UDrawer` without dragging (owner, 2026-10-02; ui.md → Overlays): no handle, and the
 * sheet can't be dragged from anywhere, so scrolling its content or tapping a stepper never moves
 * or closes it. It closes with its X, a tap outside, Escape or Back. Use it for every drawer and
 * bottom sheet; `UDrawer` itself is a lint error outside this file.
 *
 * Every prop, event and slot is `UDrawer`'s; `close` (the header's X) is on unless set to `false`.
 */
import type { DrawerProps } from '@nuxt/ui'
import { UDrawer } from '#components'

defineOptions({ inheritAttrs: false })
const attrs = useAttrs()
const { close = true } = defineProps<{ close?: DrawerProps['close'] }>()
</script>

<template>
  <UDrawer
    v-bind="attrs"
    :close="close"
    :handle="false"
    handle-only
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
