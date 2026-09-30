<script setup lang="ts">
/**
 * One order as sold (Order history's `?order=<id>`, D111, the owner's frames): its lines with
 * version, add-ons and note, the total, the payment (method, amount, riel at its own rate, KHQR
 * reference, who took it and when, and any money returned), and every recorded step with who took
 * it. A side panel from `sm`, full screen on phones. Read-only: nothing is done to an order here.
 */
import type { OrderHistoryDetail } from '#shared/contracts/reports'
import { useOrderHistoryDetail } from '../composables/useReports'
import {
  clockIn,
  eventBy,
  eventReason,
  eventTitle,
  formatRiel,
  METHOD_LABELS,
  orderNumber,
  orderTypeText,
  paymentBadge,
  progressBadge,
  returnLabel,
  stampIn,
} from '../utils/display'

const props = defineProps<{ orderId?: string }>()
const open = defineModel<boolean>('open', { required: true })

const { isCompact } = useLayoutContext()
const Slideover = resolveComponent('USlideover')
const Modal = resolveComponent('UModal')
const overlayProps = computed(() => (isCompact.value ? { fullscreen: true } : { side: 'right' as const }))

const detail = useOrderHistoryDetail(() => props.orderId)
const order = computed(() => detail.data.value ?? undefined)

const modifierText = (line: OrderHistoryDetail['lines'][number]) =>
  [line.detail, ...line.modifiers.map(m => (m.priceDeltaMinor ? `${m.name} +${formatMinor(m.priceDeltaMinor)}` : m.name))]
    .filter(Boolean)
    .join(' · ')

const timeline = computed(() => (order.value?.timeline ?? []).map((event, index) => ({
  value: index,
  title: `${eventTitle(event)} · ${clockIn(event.at, order.value!.branch.timeZone)}`,
  description: [eventBy(event), eventReason(event)].filter(Boolean).join(' · '),
  icon: event.toStatus === 'cancelled' ? 'i-lucide-circle-x' : 'i-lucide-circle-check',
})))
</script>

<template>
  <component
    :is="isCompact ? Modal : Slideover"
    v-model:open="open"
    v-bind="overlayProps"
    :title="order ? `Order ${orderNumber(order.pickupNumber)}` : 'Order'"
    :description="order ? `${orderTypeText(order)} · ${order.customerFirstName}` : 'Loading…'"
    :ui="{ body: 'space-y-6' }"
  >
    <template #body>
      <ApiErrorAlert
        v-if="detail.error.value"
        :error="detail.error.value"
        title="Couldn't load this order"
        @retry="detail.refresh()"
      />
      <div
        v-else-if="!order"
        class="space-y-3"
        aria-busy="true"
      >
        <USkeleton class="h-6 w-2/3" />
        <USkeleton class="h-24" />
        <USkeleton class="h-24" />
      </div>
      <template v-else>
        <div class="flex flex-wrap items-center gap-2">
          <UBadge
            v-bind="paymentBadge(order.payment)"
            variant="subtle"
          />
          <UBadge
            v-bind="progressBadge(order.status)"
            variant="outline"
          />
          <span class="text-sm text-muted">Placed {{ stampIn(order.placedAt, order.branch.timeZone) }}</span>
        </div>

        <section aria-labelledby="order-items">
          <h3
            id="order-items"
            class="mb-2 text-sm font-semibold text-highlighted"
          >
            Items
          </h3>
          <ul class="divide-y divide-default">
            <li
              v-for="(line, index) in order.lines"
              :key="index"
              class="flex gap-3 py-2.5 text-sm"
            >
              <span class="w-6 shrink-0 font-medium text-highlighted tabular-nums">{{ line.quantity }}×</span>
              <div class="min-w-0 flex-1">
                <p class="font-medium text-highlighted">
                  {{ line.itemName }}
                </p>
                <p
                  v-if="modifierText(line)"
                  class="text-muted"
                >
                  {{ modifierText(line) }}
                </p>
                <p
                  v-if="line.quantity > 1"
                  class="text-xs text-muted"
                >
                  {{ formatMinor(line.unitPriceMinor) }} each
                </p>
                <p
                  v-if="line.note"
                  class="text-muted italic"
                >
                  “{{ line.note }}”
                </p>
              </div>
              <span class="shrink-0 tabular-nums">{{ formatMinor(line.totalMinor) }}</span>
            </li>
          </ul>
          <p class="flex justify-between border-t border-default pt-2.5 font-semibold text-highlighted">
            <span>Total</span>
            <span class="tabular-nums">{{ formatMinor(order.totalMinor) }}</span>
          </p>
        </section>

        <section aria-labelledby="order-payment">
          <h3
            id="order-payment"
            class="mb-2 text-sm font-semibold text-highlighted"
          >
            Payment
          </h3>
          <div class="space-y-1 rounded-md border border-default p-3 text-sm">
            <template v-if="order.payment.method">
              <p class="font-medium text-highlighted">
                {{ METHOD_LABELS[order.payment.method] }} ·
                <template v-if="order.payment.method === 'cash_khr' && order.payment.amountKhr !== null">
                  {{ formatRiel(order.payment.amountKhr) }}
                  <span class="font-normal text-muted">({{ formatMinor(order.payment.amountMinor) }} at {{ formatRiel(order.payment.khrPerUsd ?? 0) }} per $1)</span>
                </template>
                <template v-else>
                  {{ formatMinor(order.payment.amountMinor) }}
                </template>
              </p>
              <p
                v-if="order.payment.reference"
                class="text-muted"
              >
                Reference {{ order.payment.reference }}
              </p>
              <p
                v-if="order.payment.collectedAt"
                class="text-muted"
              >
                Taken by {{ order.payment.collectedBy ?? 'a staff member' }}, {{ stampIn(order.payment.collectedAt, order.branch.timeZone) }}
              </p>
              <p
                v-if="order.payment.returnedAt"
                class="text-muted"
              >
                Money returned{{ order.payment.returnMethod ? ` (${returnLabel(order.payment.returnMethod)})` : '' }} by {{ order.payment.returnedBy ?? 'a staff member' }}, {{ stampIn(order.payment.returnedAt, order.branch.timeZone) }}
              </p>
            </template>
            <p
              v-else-if="order.payment.state === 'unpaid'"
              class="text-muted"
            >
              Not paid yet.
            </p>
            <p
              v-else
              class="text-muted"
            >
              Cancelled before payment: no money was taken.
            </p>
          </div>
        </section>

        <section aria-labelledby="order-timeline">
          <h3
            id="order-timeline"
            class="mb-3 text-sm font-semibold text-highlighted"
          >
            Timeline
          </h3>
          <UTimeline
            :items="timeline"
            :default-value="timeline.length - 1"
            size="xs"
          />
        </section>
      </template>
    </template>
  </component>
</template>
