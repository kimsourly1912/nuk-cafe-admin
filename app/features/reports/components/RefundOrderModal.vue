<script setup lang="ts">
/**
 * "Refund order #042?" (D233): the cafe's owner records that a ready or completed order's money went
 * back. The full payment always (shown as text, in riel when it was paid in riel), how it went back
 * (Cash or KHQR, starting from how it was paid) and why, in the owner's words. A ready order is also
 * cancelled. Open via `useOverlay().create(RefundOrderModal)`; emits `close(order)` with the order
 * as it is now, or `close()`. A refusal stays here, with Reload when the order changed meanwhile.
 * One idempotency key per request: a retry of the same one never records the refund twice.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import * as v from 'valibot'
import type { ReturnMethod } from '#shared/contracts/orders'
import { CANCEL_NOTE_MAX, REFUND_DAYS, refundOrderSchema } from '#shared/contracts/orders'
import type { OrderHistoryDetail } from '#shared/contracts/reports'
import { useRefundOrder } from '../composables/useReports'
import { orderNumber } from '../utils/display'

const props = defineProps<{ order: OrderHistoryDetail }>()
const emit = defineEmits<{ 'close': [refunded?: OrderHistoryDetail], 'update:open': [open: boolean] }>()

const schema = v.object({ returnMethod: refundOrderSchema.entries.returnMethod, note: refundOrderSchema.entries.note })
type RefundForm = { returnMethod: ReturnMethod, note: string }

const start = (): RefundForm => ({ returnMethod: props.order.payment.method === 'khqr' ? 'khqr' : 'cash', note: '' })
const state = reactive<RefundForm>(start())
const saving = ref(false)
const { isCompact: fullscreen } = useLayoutContext()
const unsaved = useModalUnsavedChanges(state, { initial: start(), paused: saving, close: () => emit('close') })

const form = useTemplateRef('form')
useFormErrorRecheck(form)
useSubmitShortcut(() => form.value?.submit())

const returnItems: { value: ReturnMethod, label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'khqr', label: 'KHQR' },
]

const amount = computed(() => {
  const payment = props.order.payment
  return payment.method === 'cash_khr' && payment.amountKhr !== null ? formatRiel(payment.amountKhr) : formatMinor(payment.amountMinor ?? props.order.totalMinor)
})
const ready = computed(() => props.order.status === 'ready')

// A new key for a changed request; the same one for a retry of the same request.
const key = ref(crypto.randomUUID())
watch(() => JSON.stringify(state), () => {
  key.value = crypto.randomUUID()
})

const refund = useRefundOrder()
/** The last refused refund, shown here: toasts are out of reach while the modal is open. */
const lastError = ref<{ message: string, changed: boolean }>()

async function onSubmit({ data }: FormSubmitEvent<v.InferOutput<typeof schema>>) {
  lastError.value = undefined
  saving.value = true
  const result = await refund.execute({ order: props.order, body: { version: props.order.version, ...data }, idempotencyKey: key.value })
  saving.value = false
  if (!result.ok) {
    if (result.status === 'error') lastError.value = { message: result.error.message, changed: result.error.code === 'ORDER_CHANGED' }
    return
  }
  unsaved.markClean()
  emit('close', result.data)
}

/** The order changed meanwhile: close, and the panel reads it again. */
function reload() {
  unsaved.markClean()
  emit('close')
}
</script>

<template>
  <AppModal
    :title="`Refund order ${orderNumber(order.pickupNumber)}?`"
    :description="ready
      ? 'Record the money you gave back. The order is also cancelled and leaves the counter.'
      : 'Record the money you gave back. The order stays completed.'"
    :fullscreen="fullscreen"
    :ui="{ footer: 'pb-[max(env(safe-area-inset-bottom),1rem)]' }"
    @update:open="unsaved.onOpenChange"
  >
    <template #body>
      <UForm
        id="refund-order-form"
        ref="form"
        :schema="schema"
        :state="state"
        :validate-on="['input', 'change']"
        :disabled="saving"
        class="space-y-4"
        @submit="onSubmit"
        @error="focusFirstInvalid"
      >
        <UAlert
          v-if="lastError"
          role="alert"
          :color="lastError.changed ? 'warning' : 'error'"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Not refunded"
          :description="lastError.message"
          :actions="lastError.changed ? [{ label: 'Reload', color: 'neutral', variant: 'outline', onClick: reload }] : undefined"
        />
        <p class="text-sm">
          Give back <span class="font-semibold text-highlighted">{{ amount }}</span>, the full payment.
          <span class="text-muted">Refunds are recorded within {{ REFUND_DAYS }} days of payment and count in reports on the day you record them.</span>
        </p>
        <UFormField
          label="How the money went back"
          name="returnMethod"
          required
        >
          <UTabs
            v-model="state.returnMethod"
            :items="returnItems"
            :content="false"
            aria-label="How the money went back"
          />
        </UFormField>
        <UFormField
          label="Why"
          name="note"
          required
          :help="`${state.note.length}/${CANCEL_NOTE_MAX}`"
        >
          <UTextarea
            v-model="state.note"
            :maxlength="CANCEL_NOTE_MAX"
            :rows="2"
            autoresize
            autofocus
            placeholder="For example: wrong drink, the customer complained"
            class="w-full"
          />
        </UFormField>
      </UForm>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Keep order"
          color="neutral"
          variant="outline"
          :disabled="saving"
          class="max-sm:flex-1 max-sm:justify-center"
          @click="unsaved.requestClose()"
        />
        <UButton
          type="submit"
          form="refund-order-form"
          :label="`Refund ${amount}`"
          color="error"
          :loading="saving"
          class="max-sm:flex-1 max-sm:justify-center"
        />
      </div>
    </template>
  </AppModal>
</template>
