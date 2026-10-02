<script setup lang="ts">
/**
 * Take payment → KHQR, once an admin set KHQR up (step 10.15, D130): a QR made for this order by the
 * server, holding the total, "Order 042" and an expiry; the customer scans it with any Cambodian
 * banking app. USD or riel when both are offered. The minutes left count by the server's clock;
 * once expired the QR fades and New QR makes another (Confirm stays: the customer may have paid at
 * the last second). The cashier confirms after the money shows in the bank app; the payment names
 * this QR (`charge`).
 *
 * With the automatic check on (a Bakong token on the server, 10.15b, D131), it asks the server every
 * 5 seconds, until 5 minutes after the QR expired; paid as it should be, the server records it as
 * this cashier and `paid` closes the panel. Something else arrived: said here, nothing recorded.
 * Bakong unavailable: said here, Confirm by hand meanwhile.
 */
import { useIntervalFn } from '@vueuse/core'
import type { CounterOrder, KhqrCharge, KhqrCheck, KhqrCurrency } from '#shared/contracts/orders'
import { useCounterActions } from '../composables/useCounterActions'
import { orderNumber } from '../utils/counter'
import { KHQR_CHECK_INTERVAL_MS, khqrAmountText, khqrCheckProblemText, khqrKeepChecking, khqrReceivedText, khqrTimeLeft } from '../utils/khqr'

const props = defineProps<{
  order: CounterOrder
  branchId: string
  currencies: KhqrCurrency[]
  /** The server's clock minus this tablet's (the queue's), so the minutes left are the server's. */
  serverOffset: number
  /** The server checks QRs with Bakong (10.15b, D131). */
  automaticCheck?: boolean
  disabled?: boolean
}>()
const charge = defineModel<KhqrCharge | null>('charge', { required: true })
const emit = defineEmits<{
  /** Bakong confirmed it and the server recorded the payment: the order as it is now. */
  paid: [order: CounterOrder]
  /** Bakong says this QR was paid, but the order was already paid another way or cancelled. */
  refund: [check: Extract<KhqrCheck, { status: 'refund_needed' }>]
}>()

const actions = useCounterActions(() => props.branchId)
const currency = ref<KhqrCurrency>(props.currencies[0] ?? 'USD')
const loading = ref(false)
const failure = ref<string | null>(null)
const nowMs = ref(Date.now())
useIntervalFn(() => {
  nowMs.value = Date.now()
}, 1000)

async function load() {
  loading.value = true
  failure.value = null
  try {
    charge.value = await actions.khqr(props.order, currency.value)
  }
  catch (error) {
    charge.value = null
    failure.value = getErrorMessage(error)
  }
  finally {
    loading.value = false
  }
}

watch([() => props.order.id, currency], load, { immediate: true })

// --- The automatic check with Bakong (10.15b, D131) ---
const check = ref<KhqrCheck | null>(null)
/** A final answer, or one only a person can fix: stop asking until Try again. */
const stopped = computed(() => {
  const status = check.value?.status
  return status === 'mismatch' || status === 'refund_needed' || status === 'paid' || (check.value?.status === 'unavailable' && check.value.problem !== 'error')
})
let checking = false

async function runCheck() {
  const current = charge.value
  if (!props.automaticCheck || !current || checking || stopped.value || props.disabled) return
  if (!khqrKeepChecking(current.expiresAt, Date.now(), props.serverOffset)) return
  checking = true
  try {
    const result = await actions.checkKhqr(props.order, current)
    if (charge.value?.id !== current.id) return
    check.value = result
    if (result.status === 'paid') emit('paid', result.order)
    if (result.status === 'refund_needed') emit('refund', result)
  }
  catch {
    // A network blip or a refusal: the next round asks again; Confirm works meanwhile.
  }
  finally {
    checking = false
  }
}
useIntervalFn(runCheck, KHQR_CHECK_INTERVAL_MS)
watch(() => charge.value?.id, () => {
  check.value = null
})

function checkAgain() {
  check.value = null
  void runCheck()
}

const timeLeft = computed(() => (charge.value ? khqrTimeLeft(charge.value.expiresAt, nowMs.value, props.serverOffset) : null))
const currencyLabel = (value: KhqrCurrency) => (value === 'KHR' ? 'Riel' : 'US dollars')
</script>

<template>
  <div class="space-y-3">
    <UFieldGroup
      v-if="currencies.length > 1"
      aria-label="KHQR currency"
      class="w-full"
    >
      <UButton
        v-for="value in currencies"
        :key="value"
        :label="currencyLabel(value)"
        :color="currency === value ? 'primary' : 'neutral'"
        :variant="currency === value ? 'soft' : 'outline'"
        :aria-pressed="currency === value"
        :disabled="disabled || loading"
        class="flex-1 justify-center"
        @click="currency = value"
      />
    </UFieldGroup>

    <!-- The automatic check's status above the QR: below it, a tablet's panel hides it under the fold. -->
    <template v-if="automaticCheck && charge">
      <UAlert
        v-if="check?.status === 'mismatch'"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="A payment arrived on this QR that doesn't match it"
        :description="`Bakong says ${khqrReceivedText(check.received)}. Nothing was recorded: check your bank app before confirming.`"
      />
      <UAlert
        v-else-if="check?.status === 'unavailable'"
        color="neutral"
        variant="subtle"
        icon="i-lucide-cloud-off"
        :title="`Automatic check unavailable. ${khqrCheckProblemText(check.problem)}`"
        description="Confirm after the payment appears in your bank app."
        :actions="check.problem === 'error' ? [] : [{ label: 'Try again', color: 'neutral', variant: 'outline', onClick: checkAgain }]"
      />
      <p
        v-else-if="check?.status !== 'refund_needed'"
        class="flex items-center gap-2 text-sm text-muted"
        role="status"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="size-4 shrink-0 animate-spin"
        />
        Waiting for the payment: it's recorded as soon as Bakong confirms it.
      </p>
    </template>
    <UAlert
      v-if="failure"
      color="warning"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="failure"
      :actions="[{ label: 'Try again', color: 'neutral', variant: 'outline', onClick: load }]"
    />
    <div
      v-else
      class="flex flex-col items-center gap-2 rounded-lg border border-default p-4 text-center"
    >
      <USkeleton
        v-if="loading && !charge"
        class="size-56 max-w-full"
      />
      <template v-else-if="charge">
        <div class="relative w-56 max-w-full">
          <QrCode
            :value="charge.qr"
            :label="`KHQR for order ${orderNumber(order)}, ${khqrAmountText(charge)}`"
            :class="{ 'opacity-15': timeLeft?.expired }"
          />
          <div
            v-if="timeLeft?.expired"
            class="absolute inset-0 flex items-center justify-center"
          >
            <UButton
              label="New QR"
              icon="i-lucide-refresh-cw"
              :loading="loading"
              :disabled="disabled"
              @click="load"
            />
          </div>
        </div>
        <p class="text-3xl font-semibold text-highlighted tabular-nums">
          {{ khqrAmountText(charge) }}
        </p>
        <p class="text-sm text-muted">
          {{ charge.billNumber }} · to {{ charge.merchantName }}
        </p>
        <p
          class="text-sm font-medium"
          :class="timeLeft?.expired ? 'text-warning' : 'text-muted'"
        >
          {{ timeLeft?.expired ? 'Expired: make a new QR before the customer scans' : `Works for ${timeLeft?.label}` }}
        </p>
      </template>
    </div>
    <p
      v-if="!automaticCheck"
      class="text-sm text-muted"
    >
      Confirm only after the payment appears in your bank app.
    </p>
  </div>
</template>
