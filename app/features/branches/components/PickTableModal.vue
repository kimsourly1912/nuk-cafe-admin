<script setup lang="ts">
/**
 * "Which table is this?" (D273, frame 2A): asked when a table look is placed from the library, since
 * every table on the map is a real one with a QR code. Closes with the chosen unplaced table's id,
 * `'new'` for New table, or nothing.
 */
import type { LayoutTable } from '#shared/contracts/shop-layout'

defineProps<{
  lookName: string
  tables: readonly LayoutTable[]
}>()
const emit = defineEmits<{ close: [choice?: string] }>()
</script>

<template>
  <AppModal
    title="Which table is this?"
    :description="`The ${lookName} goes on the map as one of your tables, with its QR code.`"
    @update:open="open => !open && emit('close')"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <p
          v-if="!tables.length"
          class="text-sm text-muted"
        >
          Every table is on the map already. Add a new one for this look.
        </p>
        <div
          v-else
          class="flex flex-wrap gap-2"
          role="group"
          aria-label="Unplaced tables"
        >
          <UButton
            v-for="table in tables"
            :key="table.id"
            :label="table.label"
            color="neutral"
            variant="outline"
            :data-testid="`pick-${table.label}`"
            @click="emit('close', table.id)"
          >
            <template #trailing>
              <span class="text-xs text-muted">{{ table.seats }} seats</span>
            </template>
          </UButton>
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          @click="emit('close')"
        />
        <UButton
          label="New table"
          icon="i-lucide-plus"
          @click="emit('close', 'new')"
        />
      </div>
    </template>
  </AppModal>
</template>
