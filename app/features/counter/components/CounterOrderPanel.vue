<script setup lang="ts">
/**
 * One order at the counter (D102, the owner's frames): a side panel on tablets, the full screen on
 * phones. The lines and the total, then what the order needs next:
 *
 * - **To pay:** the method (Cash USD · Cash riel · KHQR, "Payment starts preparation"). Cash: the
 *   amount received with quick amounts and the change to give (nothing typed = exact; less = short,
 *   and Confirm waits). Riel: the total at the rate in force, rounded up to ៛100, and when the rate
 *   was set. KHQR: no code on screen (no Bakong connection, the owner's review): the customer scans
 *   the counter's KHQR, the cashier checks the merchant app, then confirms, with an optional
 *   reference. "Confirm payment · $7.25".
 * - **Preparing / ready:** who took the payment and how; Mark ready or Complete.
 * - **Cancel order** (not once ready): the cancel dialog.
 *
 * A refused payment says why here: changed meanwhile (Reload), the 30 minutes over, or no answer
 * (Try again with the same key: never recorded twice).
 *
 * The queue refreshes underneath an open panel. If the order moves on meanwhile (another cashier
 * paid it or marked it ready), the panel says so and offers the next action only after OK:
 * otherwise a click meant for "Confirm payment" lands on the "Mark ready" that replaced it (found
 * in the release check on staging, 10.5).
 */
import type { CounterOrder, ExchangeRate, OrderStatus, PaymentMethod, PayOrderInput } from '#shared/contracts/orders'
import { toRiel } from '#shared/contracts/orders'
import { useCounterActions } from '../composables/useCounterActions'
import type { Change, CommandFailure } from '../utils/counter'
import { changeDue, clockTime, commandFailure, firstName, formatRiel, orderNumber, orderTypeText, PAYMENT_METHOD_LABELS, paymentText, rielQuickAmounts, usdQuickAmounts } from '../utils/counter'

const props = defineProps<{
  order: CounterOrder | null
  branchId: string
  khrRate: ExchangeRate | null
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ cancel: [order: CounterOrder], reload: [] }>()

const { isCompact } = useLayoutContext()
const Slideover = resolveComponent('USlideover')
const Modal = resolveComponent('UModal')
const overlayProps = computed(() => (isCompact.value ? { fullscreen: true } : { side: 'right' as const }))

const actions = useCounterActions(() => props.branchId)
const toast = useToast()

// --- The payment form ---
const method = ref<PaymentMethod>('cash_usd')
const receivedUsd = ref<number | null>(null)
const receivedKhr = ref<number | null>(null)
const reference = ref('')
const submitting = ref(false)
const failure = ref<{ kind: CommandFailure, message: string } | null>(null)

// A new order in the panel starts a new form.
watch(() => props.order?.id, () => {
  method.value = 'cash_usd'
  receivedUsd.value = null
  receivedKhr.value = null
  reference.value = ''
  failure.value = null
})

// --- A change by someone else while the panel is open ---
/** The status this panel last showed as the starting point: on opening, after its own action, after OK. */
const seenStatus = ref<OrderStatus | null>(null)
watch([open, () => props.order?.id], () => {
  seenStatus.value = props.order?.status ?? null
}, { immediate: true })
const changedMeanwhile = computed(() => {
  const order = props.order
  if (!order || seenStatus.value === null || order.status === seenStatus.value) return null
  if (order.status === 'preparing') return order.payment ? `Paid meanwhile by ${firstName(order.payment.collectedBy.name)}: it's being prepared.` : 'Paid meanwhile: it\'s being prepared.'
  if (order.status === 'ready') return 'Marked ready meanwhile.'
  if (order.status === 'completed') return 'Completed meanwhile.'
  if (order.status === 'cancelled') return 'Cancelled meanwhile.'
  return 'This order changed meanwhile.'
})
function acknowledgeChange() {
  seenStatus.value = props.order?.status ?? null
}
// Reload is the cashier asking for the order as it is now: what it brings needs no OK.
let reloading = false
watch(() => props.order?.status, (status) => {
  if (!reloading || !status) return
  seenStatus.value = status
  reloading = false
})

const totalMinor = computed(() => props.order?.totalMinor ?? 0)
const totalKhr = computed(() => (props.khrRate ? toRiel(totalMinor.value, props.khrRate.khrPerUsd) : null))

const methodItems = (Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map(value => ({ label: PAYMENT_METHOD_LABELS[value], value }))

const change = computed<Change>(() => {
  if (method.value === 'cash_usd') return changeDue(totalMinor.value, receivedUsd.value === null ? null : toMinor(receivedUsd.value))
  if (method.value === 'cash_khr' && totalKhr.value !== null) return changeDue(totalKhr.value, receivedKhr.value)
  return { kind: 'exact' }
})
const formatAmount = (amount: number) => (method.value === 'cash_khr' ? formatRiel(amount) : formatMinor(amount))

const body = computed<PayOrderInput | null>(() => {
  const order = props.order
  if (!order) return null
  if (method.value === 'cash_usd') return { version: order.version, method: 'cash_usd' }
  if (method.value === 'cash_khr') return props.khrRate ? { version: order.version, method: 'cash_khr', khrPerUsd: props.khrRate.khrPerUsd } : null
  return { version: order.version, method: 'khqr', reference: reference.value.trim() || null }
})
/** One key per payment as sent: Try again reuses it; any change makes a new one. */
const key = ref(crypto.randomUUID())
watch(() => JSON.stringify([props.order?.id, body.value]), () => {
  key.value = crypto.randomUUID()
})

const confirmLabel = computed(() => {
  if (method.value === 'cash_khr') return totalKhr.value === null ? 'Confirm payment' : `Confirm payment · ${formatRiel(totalKhr.value)}`
  return `Confirm payment · ${formatMinor(totalMinor.value)}`
})
const canConfirm = computed(() => Boolean(body.value) && change.value.kind !== 'short' && !submitting.value)

async function confirmPayment() {
  const order = props.order
  if (!order || !body.value || !canConfirm.value) return
  submitting.value = true
  failure.value = null
  try {
    await actions.pay(order, body.value, key.value)
    seenStatus.value = 'preparing'
    toast.add({ title: `Order ${orderNumber(order)} paid`, description: 'It\'s now being prepared.', color: 'success', icon: 'i-lucide-circle-check' })
    open.value = false
  }
  catch (error) {
    failure.value = commandFailure(error, 'payment')
  }
  finally {
    submitting.value = false
  }
}

function reload() {
  failure.value = null
  reloading = true
  emit('reload')
}

const nextAction = computed(() => {
  if (props.order?.status === 'preparing') return { label: 'Mark ready', run: () => actions.markReady.execute(props.order!) }
  if (props.order?.status === 'ready') return { label: 'Complete', run: () => actions.complete.execute(props.order!) }
  return null
})
async function runNext() {
  const action = nextAction.value
  const result = await action?.run()
  if (result?.ok) {
    seenStatus.value = props.order?.status ?? null
    open.value = false
  }
}
const busy = computed(() => (props.order ? actions.isBusy(props.order) : false))
</script>

<template>
  <component
    :is="isCompact ? Modal : Slideover"
    v-model:open="open"
    v-bind="overlayProps"
    :title="order ? `Order ${orderNumber(order)}` : 'Order'"
    :description="order ? `${orderTypeText(order)} · ${order.customer.name}` : undefined"
    :ui="{ body: 'space-y-5', footer: 'flex-col items-stretch gap-2' }"
  >
    <template #title>
      <span
        v-if="order"
        class="flex items-baseline gap-3"
      >
        <span class="text-3xl font-bold tabular-nums">{{ orderNumber(order) }}</span>
        <span class="text-base font-medium">{{ orderTypeText(order) }}</span>
      </span>
    </template>
    <template #description>
      <span v-if="order">{{ firstName(order.customer.name) }} · placed {{ clockTime(order.placedAt) }}</span>
    </template>

    <template #body>
      <p
        v-if="!order"
        class="text-sm text-muted"
      >
        This order isn't in the queue anymore.
      </p>
      <template v-else>
        <div
          v-if="changedMeanwhile"
          role="alert"
        >
          <UAlert
            color="warning"
            variant="subtle"
            icon="i-lucide-info"
            :title="changedMeanwhile"
            description="Check the order before the next step."
            :actions="[{ label: 'OK', color: 'neutral', variant: 'outline', onClick: acknowledgeChange }]"
          />
        </div>
        <div
          v-if="failure"
          role="alert"
        >
          <UAlert
            :color="failure.kind === 'retry' ? 'error' : 'warning'"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :title="failure.message"
            :actions="failure.kind === 'retry'
              ? [{ label: 'Try again', color: 'neutral', variant: 'outline', onClick: confirmPayment }]
              : failure.kind === 'changed' ? [{ label: 'Reload', color: 'neutral', variant: 'outline', onClick: reload }] : undefined"
          />
        </div>

        <section aria-label="Order lines">
          <ul class="divide-y divide-default">
            <li
              v-for="(line, index) in order.lines"
              :key="index"
              class="flex justify-between gap-3 py-2"
            >
              <div class="min-w-0">
                <p class="font-medium text-highlighted">
                  {{ line.quantity }} × {{ line.itemName }}
                </p>
                <p
                  v-if="line.detail"
                  class="text-sm text-muted"
                >
                  {{ line.detail }}
                </p>
                <p
                  v-if="line.note"
                  class="text-sm text-warning"
                >
                  {{ line.note }}
                </p>
              </div>
              <span class="shrink-0 text-highlighted">{{ formatMinor(line.totalMinor) }}</span>
            </li>
          </ul>
          <div class="flex items-baseline justify-between border-t border-default pt-3">
            <span class="font-semibold text-highlighted">Total</span>
            <span class="text-xl font-semibold text-highlighted">{{ formatMinor(order.totalMinor) }}</span>
          </div>
        </section>

        <section
          v-if="order.status === 'awaiting_payment'"
          aria-labelledby="payment-method"
          class="space-y-4"
        >
          <div>
            <h3
              id="payment-method"
              class="font-semibold text-highlighted"
            >
              Payment method
            </h3>
            <p class="text-sm text-muted">
              Payment starts preparation.
            </p>
          </div>
          <UTabs
            v-model="method"
            :items="methodItems"
            :content="false"
            class="w-full"
            aria-label="Payment method"
          />

          <template v-if="method === 'cash_usd'">
            <UFormField label="Amount received (USD)">
              <UInputNumber
                v-model="receivedUsd"
                :min="0"
                :step="0.25"
                :format-options="{ style: 'currency', currency: 'USD' }"
                placeholder="Exact"
                :disabled="submitting"
                class="w-full"
              />
            </UFormField>
            <div class="flex flex-wrap gap-2">
              <UButton
                v-for="amount in usdQuickAmounts(order.totalMinor)"
                :key="amount"
                :label="formatMinor(amount)"
                color="neutral"
                variant="outline"
                :disabled="submitting"
                @click="receivedUsd = fromMinor(amount)"
              />
              <UButton
                label="Exact"
                color="neutral"
                variant="outline"
                :disabled="submitting"
                @click="receivedUsd = null"
              />
            </div>
          </template>

          <template v-else-if="method === 'cash_khr'">
            <UAlert
              v-if="!khrRate"
              color="warning"
              variant="subtle"
              icon="i-lucide-triangle-alert"
              title="No riel rate is set"
              description="An admin sets it on the Payments page. Take dollars or KHQR meanwhile."
            />
            <template v-else>
              <div class="rounded-md bg-elevated p-3 text-sm">
                <p class="text-highlighted">
                  {{ formatMinor(order.totalMinor) }} × {{ formatRiel(khrRate.khrPerUsd) }} = <span class="font-semibold">{{ formatRiel(totalKhr!) }}</span>
                </p>
                <p class="text-muted">
                  Rounded up to ៛100 · rate set {{ clockTime(khrRate.effectiveFrom) }} by {{ firstName(khrRate.setBy.name) }}
                </p>
              </div>
              <UFormField label="Amount received (៛)">
                <UInputNumber
                  v-model="receivedKhr"
                  :min="0"
                  :step="100"
                  placeholder="Exact"
                  :disabled="submitting"
                  class="w-full"
                />
              </UFormField>
              <div class="flex flex-wrap gap-2">
                <UButton
                  v-for="amount in rielQuickAmounts(totalKhr!)"
                  :key="amount"
                  :label="formatRiel(amount)"
                  color="neutral"
                  variant="outline"
                  :disabled="submitting"
                  @click="receivedKhr = amount"
                />
                <UButton
                  label="Exact"
                  color="neutral"
                  variant="outline"
                  :disabled="submitting"
                  @click="receivedKhr = null"
                />
              </div>
            </template>
          </template>

          <template v-else>
            <UAlert
              color="neutral"
              variant="subtle"
              icon="i-lucide-qr-code"
              :title="`Ask the customer to scan the counter KHQR and pay ${formatMinor(order.totalMinor)}.`"
              description="Confirm only after the payment appears in your merchant app."
            />
            <UFormField
              label="Transaction reference"
              hint="Optional"
            >
              <UInput
                v-model="reference"
                maxlength="64"
                :disabled="submitting"
                class="w-full"
              />
            </UFormField>
          </template>

          <div
            v-if="method !== 'khqr' && change.kind !== 'exact'"
            class="rounded-md p-3"
            :class="change.kind === 'short' ? 'bg-error/10' : 'bg-elevated'"
            role="status"
          >
            <p class="text-sm text-muted">
              {{ change.kind === 'short' ? 'Short by' : `Change (${method === 'cash_khr' ? 'riel' : 'USD'})` }}
            </p>
            <p
              class="text-3xl font-semibold"
              :class="change.kind === 'short' ? 'text-error' : 'text-highlighted'"
            >
              {{ formatAmount(change.amount) }}
            </p>
          </div>
        </section>

        <p
          v-else-if="order.payment"
          class="text-sm text-muted"
        >
          {{ paymentText(order.payment) }}
        </p>
      </template>
    </template>

    <template
      v-if="order && order.status !== 'completed' && order.status !== 'cancelled' && !changedMeanwhile"
      #footer
    >
      <UButton
        v-if="order.status === 'awaiting_payment'"
        :label="confirmLabel"
        size="lg"
        block
        :loading="submitting"
        :disabled="!canConfirm"
        @click="confirmPayment"
      />
      <UButton
        v-else-if="nextAction"
        :label="nextAction.label"
        size="lg"
        block
        :loading="busy"
        :disabled="busy"
        @click="runNext"
      />
      <UButton
        v-if="order.status === 'awaiting_payment' || order.status === 'preparing'"
        label="Cancel order"
        color="neutral"
        variant="link"
        class="self-center"
        :disabled="submitting || busy"
        @click="emit('cancel', order)"
      />
    </template>
  </component>
</template>
