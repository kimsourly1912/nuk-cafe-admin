<script setup lang="ts">
/**
 * A table's QR code, large enough to scan from the screen, with its link and downloads for
 * printing (D91). The QR is the same every time until it's rotated. Full screen on phones.
 */
import { useClipboard } from '@vueuse/core'
import type { DiningTable } from '#shared/contracts/branches'
import { downloadQrPng, downloadQrSvg } from '../utils/qr'
import TableQrCode from './TableQrCode.vue'

const props = defineProps<{ table: DiningTable & { qrUrl: string } }>()
defineEmits<{ close: [] }>()

const { isCompact: fullscreen } = useLayoutContext()
const { copy, copied } = useClipboard({ legacy: true })
</script>

<template>
  <UModal
    :title="`QR code: ${table.label}`"
    :description="table.area ?? 'Scan it to order for this table.'"
    :fullscreen="fullscreen"
  >
    <template #body>
      <div class="space-y-4">
        <TableQrCode
          :value="table.qrUrl"
          :label="`QR code for ${table.label}`"
          class="mx-auto w-full max-w-64"
        />
        <UFieldGroup class="w-full">
          <UInput
            :model-value="props.table.qrUrl"
            readonly
            aria-label="QR link"
            class="w-full"
          />
          <UButton
            :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
            color="neutral"
            variant="outline"
            :aria-label="copied ? 'Copied' : 'Copy link'"
            @click="copy(props.table.qrUrl)"
          />
        </UFieldGroup>
        <p class="text-sm text-muted">
          Print it and place it on the table. It keeps working until you give the table a new QR code or archive it.
        </p>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <UButton
          label="Download SVG"
          icon="i-lucide-download"
          color="neutral"
          variant="outline"
          @click="downloadQrSvg(props.table.qrUrl, props.table.label)"
        />
        <UButton
          label="Download PNG"
          icon="i-lucide-download"
          @click="downloadQrPng(props.table.qrUrl, props.table.label)"
        />
      </div>
    </template>
  </UModal>
</template>
