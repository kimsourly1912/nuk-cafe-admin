<script setup lang="ts">
/**
 * A finished order, read only (step 10.2, D117, the owner's frames): the number and status, the
 * items and total, why it was cancelled (the staff's own note included, and how the money went
 * back), and the timeline with who took each step. Only Close: nothing here changes an order.
 */
import type { CounterOrderHistory } from '#shared/contracts/orders'
import { clockTime, orderNumber, orderTypeText, firstName } from '../utils/counter'
import { cancellationSummary, timelineItems } from '../utils/finished'

const props = defineProps<{
  history: CounterOrderHistory | null
  loading: boolean
  error: ApiError | null
}>()
const emit = defineEmits<{ close: [], retry: [] }>()

const order = computed(() => props.history?.order ?? null)
const cancelled = computed(() => (props.history ? cancellationSummary(props.history) : null))
const steps = computed(() => (props.history ? timelineItems(props.history) : []))
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
      <ApiErrorAlert
        v-if="error && !history"
        :error="error"
        title="Couldn't load this order"
        @retry="emit('retry')"
      />
      <div
        v-else-if="loading && !history"
        class="space-y-3"
        aria-busy="true"
        aria-label="Loading the order"
      >
        <USkeleton class="h-8 w-40" />
        <USkeleton class="h-24 w-full" />
        <USkeleton class="h-40 w-full" />
      </div>

      <template v-else-if="order && history">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="text-2xl font-semibold text-highlighted">
              Order {{ orderNumber(order) }}
            </h2>
            <p class="text-muted">
              {{ orderTypeText(order) }} · {{ firstName(order.customer.name) }}
            </p>
          </div>
          <UBadge
            :label="order.status === 'completed' ? 'Completed' : 'Cancelled'"
            :color="order.status === 'completed' ? 'success' : 'neutral'"
            variant="subtle"
          />
        </div>

        <section
          aria-label="Items"
          class="space-y-2"
        >
          <h3 class="font-semibold text-highlighted">
            Items
          </h3>
          <ul class="space-y-2 text-sm">
            <li
              v-for="(line, index) in order.lines"
              :key="index"
              class="flex justify-between gap-3"
            >
              <div class="min-w-0">
                <p class="text-highlighted">
                  {{ line.quantity }} × {{ line.itemName }}
                </p>
                <p
                  v-if="line.detail"
                  class="text-muted"
                >
                  {{ line.detail }}
                </p>
                <p
                  v-if="line.note"
                  class="text-muted italic"
                >
                  “{{ line.note }}”
                </p>
              </div>
              <span class="shrink-0 text-highlighted">{{ formatMinor(line.totalMinor) }}</span>
            </li>
          </ul>
          <div class="flex items-baseline justify-between border-t border-default pt-2">
            <span class="font-semibold text-highlighted">Total</span>
            <span class="font-semibold text-highlighted">{{ formatMinor(order.totalMinor) }}</span>
          </div>
        </section>

        <div
          v-if="cancelled"
          class="space-y-1 rounded-lg bg-elevated p-3 text-sm"
        >
          <p class="font-medium text-highlighted">
            {{ cancelled.title }}
          </p>
          <p
            v-if="cancelled.note"
            class="text-muted"
          >
            {{ cancelled.note }}
          </p>
          <p
            v-if="cancelled.returned"
            class="border-t border-default pt-2 text-muted"
          >
            {{ cancelled.returned }}
          </p>
        </div>

        <section
          aria-label="Timeline"
          class="space-y-2"
        >
          <h3 class="font-semibold text-highlighted">
            Timeline
          </h3>
          <ol class="relative space-y-3 border-s border-default ps-4">
            <li
              v-for="(step, index) in steps"
              :key="index"
              class="relative"
            >
              <span
                class="absolute -start-[1.3rem] top-1.5 size-2.5 rounded-full border-2 border-accented bg-default"
                aria-hidden="true"
              />
              <p class="font-medium text-highlighted">
                {{ step.label }}
              </p>
              <p class="text-sm text-muted">
                {{ clockTime(step.at) }}<template v-if="step.detail">
                  · {{ step.detail }}
                </template>
              </p>
            </li>
          </ol>
        </section>
      </template>
    </div>
    <div class="border-t border-default p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
      <UButton
        label="Close"
        color="neutral"
        variant="outline"
        block
        @click="emit('close')"
      />
    </div>
  </div>
</template>
