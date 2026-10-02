<script setup lang="ts">
/**
 * A QR code as an image: a table's link (D91), an order's KHQR at the counter (D130). Dark on light
 * in both themes: scanners need the contrast, so its colors belong to the image (`utils/qr-code.ts`),
 * not the UI theme.
 */

const props = defineProps<{
  value: string
  /** What it is, for screen readers: "QR code for Table 01". */
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
