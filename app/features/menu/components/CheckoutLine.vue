<script setup lang="ts">
/**
 * One line of Review order (D100, the owner's mockups): the item as the server priced it, its
 * quantity (1–20) and Remove, a note for the counter ("Add a note", at most 140 characters), and
 * what's wrong with it when it can't be ordered. A price that changed since the customer saw it is
 * shown struck through next to the new one.
 */
import type { QuoteLine } from '#shared/contracts/orders'
import { LINE_NOTE_MAX } from '#shared/contracts/orders'
import type { CartLine } from '../utils/cart'
import { MAX_LINE_QUANTITY } from '../utils/cart'

const props = defineProps<{
  line: CartLine
  /** The server's answer for this line; absent while the quote is loading. */
  quoted?: QuoteLine
  /** The unit price the customer saw before it changed. */
  previousUnitPriceMinor?: number
  disabled?: boolean
}>()
const emit = defineEmits<{
  'set-quantity': [quantity: number]
  'set-note': [note: string]
}>()

const name = computed(() => props.quoted?.name ?? props.line.name)
const problem = computed(() => props.quoted?.problem ?? null)
const noteOpen = ref(Boolean(props.line.note))
</script>

<template>
  <li
    class="space-y-3 py-4"
    :aria-label="name"
  >
    <div class="flex gap-3">
      <img
        v-if="quoted?.imageUrl"
        :src="quoted.imageUrl"
        alt=""
        class="size-14 shrink-0 rounded-md object-cover"
      >
      <div class="min-w-0 flex-1">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p
              class="font-medium"
              :class="problem ? 'text-muted' : 'text-highlighted'"
            >
              {{ name }}
            </p>
            <p
              v-if="quoted?.detail"
              class="text-sm text-muted"
            >
              {{ quoted.detail }}
            </p>
          </div>
          <div
            v-if="quoted && quoted.totalMinor !== null"
            class="shrink-0 text-end"
          >
            <p class="font-medium text-highlighted">
              {{ formatMinor(quoted.totalMinor) }}
            </p>
            <p
              v-if="line.quantity > 1 || previousUnitPriceMinor !== undefined"
              class="text-xs text-muted"
            >
              <span
                v-if="previousUnitPriceMinor !== undefined"
                class="line-through"
              >{{ formatMinor(previousUnitPriceMinor) }}</span>
              {{ formatMinor(quoted.unitPriceMinor!) }} each
            </p>
          </div>
        </div>
        <div
          v-if="problem"
          class="mt-2 flex flex-wrap items-center gap-2"
        >
          <UBadge
            :label="problem.code === 'SOLD_OUT' ? 'Sold out' : 'Not available'"
            color="error"
            variant="subtle"
          />
          <span class="text-sm text-muted">{{ problem.message }}</span>
        </div>
      </div>
    </div>

    <!-- The same shape as the order's line on the menu (D128): the note on the left, the trash and
         the quantity on the right; lined up under the name, past the photo when there is one. -->
    <div
      class="flex items-center justify-between gap-2"
      :class="{ 'sm:ps-17': quoted?.imageUrl }"
    >
      <UButton
        v-if="!problem && !noteOpen"
        label="Add a note"
        icon="i-lucide-notebook-pen"
        color="neutral"
        variant="link"
        size="sm"
        class="px-0"
        :disabled="disabled"
        @click="noteOpen = true"
      />
      <span v-else />
      <div class="flex items-center gap-1">
        <UButton
          :label="problem ? 'Remove' : undefined"
          icon="i-lucide-trash-2"
          color="neutral"
          :variant="problem ? 'outline' : 'ghost'"
          :disabled="disabled"
          :aria-label="`Remove ${name}`"
          @click="emit('set-quantity', 0)"
        />
        <QuantityStepper
          v-if="!problem"
          :model-value="line.quantity"
          :max="MAX_LINE_QUANTITY"
          :disabled="disabled"
          :label="name"
          @update:model-value="value => emit('set-quantity', value)"
        />
      </div>
    </div>

    <div
      v-if="!problem && noteOpen"
      :class="{ 'sm:ps-17': quoted?.imageUrl }"
    >
      <UFormField
        :label="`Note for ${name}`"
        :help="`${(line.note ?? '').length}/${LINE_NOTE_MAX}`"
        :ui="{ label: 'sr-only', help: 'text-end' }"
      >
        <UTextarea
          :model-value="line.note ?? ''"
          :maxlength="LINE_NOTE_MAX"
          :rows="2"
          autoresize
          placeholder="Add a note (optional), e.g. Less ice"
          :disabled="disabled"
          class="w-full"
          @update:model-value="value => emit('set-note', String(value ?? ''))"
        />
      </UFormField>
    </div>
  </li>
</template>
