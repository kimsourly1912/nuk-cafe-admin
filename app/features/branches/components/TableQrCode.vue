<script setup lang="ts">
/**
 * A table's QR code as an image (D91). Dark on light in both themes: scanners need the contrast,
 * so its colors belong to the image (`utils/qr.ts`), not the UI theme.
 */
import { qrImage } from '../utils/qr'

const props = defineProps<{
  value: string
  /** What it opens, for screen readers: "QR code for Table 01". */
  label: string
}>()

const image = computed(() => qrImage(props.value))
</script>

<template>
  <svg
    :viewBox="`0 0 ${image.size} ${image.size}`"
    shape-rendering="crispEdges"
    role="img"
    :aria-label="label"
    class="rounded-md"
  >
    <rect
      :width="image.size"
      :height="image.size"
      fill="#fff"
    />
    <path
      :d="image.path"
      fill="#000"
    />
  </svg>
</template>
