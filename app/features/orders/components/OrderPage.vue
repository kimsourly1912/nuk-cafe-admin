<script setup lang="ts">
/**
 * `/orders/<id>`, the customer's order (step 6.2b, D100), tracked (step 6.5b, D114, the owner's
 * frames styled by Nuxt UI, D74): the pickup number as the hero with its status, the four steps,
 * what to do next, the time left to pay, the payment, and the order's lines. Ready stands out (a
 * success panel and "Ready: 042" as the tab title). While unpaid: Cancel order (a confirm sheet).
 * Completed: Order again. Cancelled: why.
 *
 * Two columns from `lg` (the status, then the details), one on phones. Read again every 10 seconds
 * while it's in progress and the tab is visible (D114). Browser-only (`routeRules`): only its
 * customer may read it (`GET /api/shop/orders/{id}`: anyone else's is "not found", like an unknown id).
 */
import { useIntervalFn } from '@vueuse/core'
import type { Order } from '#shared/contracts/orders'
import { accountLink, ACCOUNT_PATHS } from '~/features/account'
import { useOrderAgain } from '~/features/menu'
import { useOrderTracking } from '../composables/useOrders'
import { cancellationText, clockTime, countdown, formatPickupNumber, isInProgress, nextStep, orderTypeText, paymentText, statusBadge } from '../utils/order'
import CancelOrderSheet from './CancelOrderSheet.vue'
import OrdersHeader from './OrdersHeader.vue'
import OrderTracker from './OrderTracker.vue'

const route = useRoute()
const id = computed(() => String(route.params.id ?? ''))
const query = useOrderTracking(id)
const order = computed(() => query.data.value ?? null)
const errorKind = computed(() => query.error.value?.kind)
const badge = computed(() => (order.value ? statusBadge(order.value.status) : null))
const number = computed(() => (order.value ? formatPickupNumber(order.value.pickupNumber) : ''))

// This device's clock, for the countdown and "Updated …" (the server's expiry decides, D104).
const now = ref(Date.now())
useIntervalFn(() => {
  now.value = Date.now()
}, 15_000)
const timeLeft = computed(() => (order.value?.status === 'awaiting_payment' ? countdown(order.value.paymentDueAt, now.value) : null))
const updatedText = computed(() => {
  const at = query.updatedAt.value
  if (!at) return ''
  const minutes = Math.floor((now.value - at) / 60_000)
  return minutes < 1 ? 'Updated just now' : `Updated ${minutes} min ago`
})
const cancelled = computed(() => (order.value?.status === 'cancelled' ? cancellationText(order.value) : null))
const paid = computed(() => (order.value ? paymentText(order.value) : null))

useHead({
  title: () => (order.value?.status === 'ready' ? `Ready: ${number.value}` : String(route.meta.title ?? 'Your order')),
})
useSeoMeta({ robots: 'noindex' })

// --- Cancel ---
const cancelOpen = ref(false)
const toast = useToast()
function onCancelled(result: Order) {
  query.data.value = result
  toast.add({ title: `Order ${formatPickupNumber(result.pickupNumber)} cancelled`, color: 'success', icon: 'i-lucide-circle-check' })
}

// --- Order again ---
const { orderAgain } = useOrderAgain()
const reordering = ref(false)
const notify = useNotify()
async function again(from: Order) {
  reordering.value = true
  try {
    const lines = from.lines.map(line => ({
      itemId: line.itemId,
      variationId: line.variationId,
      modifierIds: line.modifiers.map(m => m.id),
      quantity: line.quantity,
      note: line.note,
      name: line.itemName,
    }))
    const result = await orderAgain({ branchId: from.branch.id, lines })
    if (!result.added) {
      toast.add({ title: 'Nothing from this order is available now', description: `${previewList(result.skipped)} ${result.skipped.length === 1 ? 'isn\'t' : 'aren\'t'} on the menu now.`, color: 'warning', icon: 'i-lucide-triangle-alert' })
      return
    }
    const skipped = result.skipped.length ? ` ${previewList(result.skipped)} ${result.skipped.length === 1 ? 'isn\'t' : 'aren\'t'} available now.` : ''
    toast.add({ title: `Added ${pluralize(result.added, ['item', 'items'])} to your order`, description: skipped.trim() || undefined, color: result.skipped.length ? 'warning' : 'success', icon: 'i-lucide-shopping-bag' })
    await navigateTo('/')
  }
  catch (error) {
    notify.error('Couldn\'t load the menu', error)
  }
  finally {
    reordering.value = false
  }
}
</script>

<template>
  <div class="min-h-dvh bg-muted">
    <OrdersHeader />

    <main class="mx-auto max-w-5xl px-4 py-6 max-sm:px-0 max-sm:py-0">
      <div
        v-if="query.loading.value"
        class="mx-auto max-w-lg space-y-3 p-4"
        aria-busy="true"
        aria-label="Loading your order"
      >
        <USkeleton class="mx-auto h-16 w-40" />
        <USkeleton class="h-24 w-full" />
      </div>

      <UCard
        v-else-if="errorKind === 'unauthorized'"
        class="mx-auto max-w-lg max-sm:rounded-none max-sm:ring-0"
      >
        <div class="space-y-3 text-center">
          <p class="font-medium text-highlighted">
            Sign in to see this order
          </p>
          <UButton
            label="Sign in"
            :to="accountLink(ACCOUNT_PATHS.signIn, route.fullPath)"
          />
        </div>
      </UCard>

      <UCard
        v-else-if="!order"
        class="mx-auto max-w-lg max-sm:rounded-none max-sm:ring-0"
      >
        <div class="space-y-3 text-center">
          <p class="font-medium text-highlighted">
            {{ errorKind === 'not_found' ? 'This order wasn\'t found' : 'Couldn\'t load this order' }}
          </p>
          <p class="text-sm text-muted">
            {{ errorKind === 'not_found' ? 'It may belong to another account.' : 'Check your connection and try again.' }}
          </p>
          <div class="flex justify-center gap-2">
            <UButton
              v-if="errorKind !== 'not_found'"
              label="Try again"
              color="neutral"
              variant="outline"
              @click="query.refresh()"
            />
            <UButton
              label="Back to the menu"
              to="/"
            />
          </div>
        </div>
      </UCard>

      <div
        v-else
        class="grid gap-4 max-sm:gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-6"
      >
        <!-- The status -->
        <section
          class="space-y-4"
          aria-label="Order status"
        >
          <UCard
            class="max-sm:rounded-none max-sm:ring-0"
            :class="order.status === 'ready' && 'bg-success/10 ring-success/40'"
            :ui="{ body: 'space-y-3 text-center' }"
          >
            <p
              v-if="order.status === 'ready'"
              class="text-xl font-semibold text-success"
            >
              Ready for pickup
            </p>
            <p
              v-else
              class="text-sm text-muted"
            >
              {{ order.orderType === 'dine_in' && order.table ? `${orderTypeText(order)} order` : 'Your number' }}
            </p>
            <h1
              class="font-bold tracking-tight tabular-nums"
              :class="order.status === 'ready' ? 'text-7xl text-success' : 'text-6xl text-highlighted'"
              :aria-label="`Your number ${number}`"
            >
              {{ number }}
            </h1>
            <UBadge
              v-if="badge"
              :label="badge.label"
              :color="badge.color"
              :icon="badge.icon"
              variant="subtle"
            />
            <p
              v-if="nextStep(order)"
              class="font-medium text-highlighted"
            >
              {{ nextStep(order) }}
            </p>
            <p
              v-if="order.status === 'ready' && order.orderType === 'dine_in'"
              class="text-sm text-muted"
            >
              Collect it at the counter.
            </p>
          </UCard>

          <UCard
            v-if="order.status !== 'cancelled'"
            class="max-sm:rounded-none max-sm:ring-0"
            :ui="{ body: 'space-y-4' }"
          >
            <OrderTracker :status="order.status" />

            <UAlert
              v-if="timeLeft"
              :color="timeLeft.urgent ? 'error' : 'warning'"
              variant="subtle"
              icon="i-lucide-clock"
              :title="timeLeft.over ? 'Time\'s up: this order will be cancelled' : `Pay at the counter by ${clockTime(order.paymentDueAt)}`"
              :description="timeLeft.over ? 'Place a new order if you still want it.' : `${timeLeft.minutes} min left. Unpaid orders are cancelled after 30 minutes.`"
            />
            <p
              v-if="paid"
              class="flex items-center gap-2 text-sm text-highlighted"
            >
              <UIcon
                name="i-lucide-receipt"
                class="size-4 shrink-0 text-muted"
              />
              {{ paid }}
            </p>
            <UAlert
              v-if="order.status === 'completed' && order.completedAt"
              color="success"
              variant="subtle"
              icon="i-lucide-circle-check"
              :title="`Picked up at ${clockTime(order.completedAt)}`"
              description="Thanks for ordering. Enjoy!"
            />
            <p
              v-if="isInProgress(order.status) && updatedText"
              class="text-xs text-muted"
              aria-live="polite"
            >
              {{ updatedText }}
            </p>
          </UCard>

          <UCard
            v-else-if="cancelled"
            class="max-sm:rounded-none max-sm:ring-0"
          >
            <div class="flex gap-3">
              <UIcon
                name="i-lucide-circle-x"
                class="mt-0.5 size-5 shrink-0 text-muted"
              />
              <div class="space-y-1">
                <p class="font-medium text-highlighted">
                  {{ cancelled.title }}
                </p>
                <p
                  v-if="cancelled.detail"
                  class="text-sm text-muted"
                >
                  {{ cancelled.detail }}
                </p>
                <p
                  v-if="order.cancelledAt"
                  class="text-sm text-muted"
                >
                  Cancelled at {{ clockTime(order.cancelledAt) }}
                </p>
              </div>
            </div>
          </UCard>
        </section>

        <!-- The details -->
        <section
          class="space-y-4"
          aria-label="Order details"
        >
          <UCard
            class="max-sm:rounded-none max-sm:ring-0"
            :ui="{ footer: 'max-sm:pb-[max(env(safe-area-inset-bottom),1rem)]' }"
          >
            <p class="mb-3 text-sm text-muted">
              {{ order.branch.name }} · {{ orderTypeText(order) }} · Placed {{ clockTime(order.placedAt) }}
            </p>
            <ul
              class="space-y-2 text-sm"
              aria-label="Order summary"
            >
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
            <div class="mt-4 flex items-baseline justify-between border-t border-default pt-3">
              <span class="font-semibold text-highlighted">Total</span>
              <span class="text-lg font-semibold text-highlighted">{{ formatMinor(order.totalMinor) }}</span>
            </div>

            <template #footer>
              <div class="flex flex-col gap-2">
                <UButton
                  v-if="order.status === 'completed'"
                  label="Order again"
                  icon="i-lucide-rotate-ccw"
                  block
                  :loading="reordering"
                  @click="again(order)"
                />
                <UButton
                  label="Back to the menu"
                  to="/"
                  block
                  :color="order.status === 'completed' ? 'neutral' : 'primary'"
                  :variant="order.status === 'completed' ? 'outline' : 'solid'"
                />
                <UButton
                  label="Your orders"
                  to="/orders"
                  block
                  color="neutral"
                  variant="ghost"
                />
                <UButton
                  v-if="order.status === 'awaiting_payment'"
                  label="Cancel order"
                  color="error"
                  variant="ghost"
                  block
                  @click="cancelOpen = true"
                />
              </div>
            </template>
          </UCard>
        </section>

        <!-- Stays mounted after a refusal, so its words stay while the page shows the new status. -->
        <CancelOrderSheet
          v-model:open="cancelOpen"
          :order="order"
          @cancelled="onCancelled"
          @changed="query.refresh()"
        />
      </div>
    </main>
  </div>
</template>
