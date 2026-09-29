<script setup lang="ts">
/**
 * A dining table (D91, the owner's mockup): its QR code (tap to view it large), name, area and
 * status, with View QR and New QR code as its actions, and ⋮ for Edit and Archive (or Restore). An
 * archived table has no working QR, so it shows Restore instead. Laid out by its own width.
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { DiningTable } from '#shared/contracts/branches'
import TableQrCode from './TableQrCode.vue'

const props = defineProps<{
  table: DiningTable
  actions: DropdownMenuItem[]
  busy?: boolean
}>()
const emit = defineEmits<{ view: [], rotate: [], restore: [] }>()

const archived = computed(() => props.table.status === 'archived')
</script>

<template>
  <UCard
    as="article"
    variant="outline"
    :aria-label="table.label"
    :aria-busy="busy || undefined"
    :class="busy && 'pointer-events-none opacity-50'"
    :ui="{ root: '@container flex flex-col', body: 'flex-1' }"
  >
    <div class="flex items-start gap-4">
      <UButton
        v-if="table.qrUrl"
        color="neutral"
        variant="outline"
        :aria-label="`View QR code for ${table.label}`"
        class="size-20 shrink-0 p-1.5"
        @click="emit('view')"
      >
        <TableQrCode
          :value="table.qrUrl"
          :label="`QR code for ${table.label}`"
          class="size-full"
        />
      </UButton>
      <div
        v-else
        class="flex size-20 shrink-0 items-center justify-center rounded-md bg-elevated text-dimmed"
      >
        <UIcon
          name="i-lucide-qr-code"
          class="size-8"
        />
      </div>

      <div class="min-w-0 flex-1 space-y-1">
        <h3
          class="break-words font-semibold"
          :class="archived ? 'text-muted' : 'text-highlighted'"
        >
          {{ table.label }}
        </h3>
        <p
          v-if="table.area"
          class="truncate text-sm text-muted"
        >
          {{ table.area }}
        </p>
        <UBadge
          :label="archived ? 'Archived' : 'Active'"
          :icon="archived ? 'i-lucide-archive' : 'i-lucide-circle-check'"
          :color="archived ? 'neutral' : 'success'"
          variant="subtle"
        />
      </div>

      <UIcon
        v-if="busy"
        name="i-lucide-loader-circle"
        class="size-5 shrink-0 animate-spin text-muted"
        aria-label="Working…"
      />
      <UDropdownMenu
        v-else
        :items="actions"
        :content="{ align: 'end' }"
      >
        <UButton
          icon="i-lucide-ellipsis-vertical"
          color="neutral"
          variant="ghost"
          :aria-label="`Actions for ${table.label}`"
        />
      </UDropdownMenu>
    </div>

    <template #footer>
      <div
        v-if="archived"
        class="flex justify-end"
      >
        <UButton
          label="Restore"
          icon="i-lucide-archive-restore"
          color="neutral"
          variant="outline"
          :aria-label="`Restore ${table.label}`"
          @click="emit('restore')"
        />
      </div>
      <div
        v-else
        class="grid grid-cols-2 gap-2"
      >
        <UButton
          label="View QR"
          icon="i-lucide-eye"
          variant="soft"
          block
          :aria-label="`View QR for ${table.label}`"
          @click="emit('view')"
        />
        <UButton
          label="New QR"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          block
          :aria-label="`New QR code for ${table.label}`"
          @click="emit('rotate')"
        />
      </div>
    </template>
  </UCard>
</template>
