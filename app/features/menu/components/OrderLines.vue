<script setup lang="ts">
/**
 * The lines of the order before checkout (D93, D124; the card's shape from the owner's frame, D128):
 * each line a soft card with the photo, the name, the choices and the line's total; under a divider,
 * "Add a note" on the left and the trash and `<QuantityStepper>` on the right (from 1: removing is
 * the trash's job, so "−" can't remove a line by accident). A line whose item left the menu or sold
 * out says so, doesn't count, and can only be removed. The panel or sheet around it keeps its header
 * and totals in view. The note travels with the line to Review order.
 */
import { LINE_NOTE_MAX } from '#shared/contracts/orders'
import type { ResolvedCart } from '../utils/cart'
import { MAX_LINE_QUANTITY } from '../utils/cart'

defineProps<{ cart: ResolvedCart }>()
const emit = defineEmits<{
  'set-quantity': [key: string, quantity: number]
  'set-note': [key: string, note: string]
}>()

/** Lines whose note box was opened here; a line with a note shows it already. */
const notesOpen = ref(new Set<string>())

/** Kept open while typing, even when the text is cleared. */
function setNote(key: string, note: string) {
  notesOpen.value.add(key)
  emit('set-note', key, note)
}
</script>

<template>
  <div
    v-if="!cart.lines.length"
    class="flex flex-col items-center gap-2 rounded-lg border border-dashed border-default px-4 py-8 text-center"
  >
    <UIcon
      name="i-lucide-shopping-bag"
      class="size-8 text-dimmed"
    />
    <p class="font-medium text-highlighted">
      Your order is empty
    </p>
    <p class="text-sm text-muted">
      Add items from the menu.
    </p>
  </div>

  <ul
    v-else
    class="flex flex-col gap-3"
    aria-label="Items in your order"
  >
    <li
      v-for="line in cart.lines"
      :key="line.key"
      :aria-label="line.name"
    >
      <UCard
        variant="subtle"
        :ui="{ body: 'p-3 sm:p-3' }"
      >
        <div class="flex gap-3">
          <img
            v-if="line.imageUrl"
            :src="line.imageUrl"
            alt=""
            class="size-14 shrink-0 rounded-md object-cover"
          >
          <div
            v-else
            class="flex size-14 shrink-0 items-center justify-center rounded-md bg-elevated"
          >
            <UIcon
              name="i-lucide-coffee"
              class="size-6 text-dimmed"
            />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-start justify-between gap-3">
              <p
                class="min-w-0 font-medium"
                :class="line.available ? 'text-highlighted' : 'text-muted line-through'"
              >
                {{ line.name }}
              </p>
              <span
                v-if="line.available"
                class="shrink-0 font-semibold text-highlighted tabular-nums"
              >{{ formatMinor(line.unitPriceMinor * line.quantity) }}</span>
            </div>
            <p
              v-if="line.detail"
              class="text-sm text-muted"
            >
              {{ line.detail }}
            </p>
            <UBadge
              v-if="!line.available"
              label="No longer available"
              color="warning"
              variant="subtle"
              size="sm"
              class="mt-1"
            />
          </div>
        </div>

        <USeparator class="my-3" />

        <div class="flex items-center justify-between gap-2">
          <UButton
            v-if="line.available && !line.note && !notesOpen.has(line.key)"
            label="Add a note"
            icon="i-lucide-notebook-pen"
            color="neutral"
            variant="link"
            size="sm"
            class="px-0"
            @click="notesOpen.add(line.key)"
          />
          <span v-else />
          <div class="flex items-center gap-1">
            <UButton
              icon="i-lucide-trash-2"
              color="neutral"
              variant="ghost"
              size="sm"
              :aria-label="`Remove ${line.name}`"
              @click="emit('set-quantity', line.key, 0)"
            />
            <QuantityStepper
              v-if="line.available"
              :model-value="line.quantity"
              :max="MAX_LINE_QUANTITY"
              :label="line.name"
              size="sm"
              @update:model-value="value => emit('set-quantity', line.key, value)"
            />
          </div>
        </div>

        <UFormField
          v-if="line.available && (line.note || notesOpen.has(line.key))"
          :label="`Note for ${line.name}`"
          :help="`${(line.note ?? '').length}/${LINE_NOTE_MAX}`"
          :ui="{ label: 'sr-only', help: 'text-end' }"
          class="mt-2"
        >
          <UTextarea
            :model-value="line.note ?? ''"
            :maxlength="LINE_NOTE_MAX"
            :rows="2"
            autoresize
            placeholder="Add a note (optional), e.g. Less ice"
            class="w-full"
            @update:model-value="value => setNote(line.key, String(value ?? ''))"
          />
        </UFormField>
      </UCard>
    </li>
  </ul>
</template>
