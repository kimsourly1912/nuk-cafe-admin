<script setup lang="ts">
/**
 * "Cancel order 042?" (D102, the owner's frames): a reason (words required with "Other"). A paid
 * order being prepared also records how the money went back, cash or KHQR; the amount is the full
 * payment, shown as text (the server always returns all of it, Q36). A dialog; a bottom sheet on
 * phones. A refusal (changed meanwhile, no answer) is shown here, with Reload or Try again.
 */
import type { CancelOrderInput, CancelReason, CounterOrder, ReturnMethod } from '#shared/contracts/orders'
import { CANCEL_NOTE_MAX } from '#shared/contracts/orders'
import { useCounterActions } from '../composables/useCounterActions'
import type { CommandFailure } from '../utils/counter'
import { commandFailure, formatRiel, orderNumber } from '../utils/counter'

const props = defineProps<{ order: CounterOrder | null, branchId: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ cancelled: [], reload: [] }>()

const { isCompact } = useLayoutContext()
const Modal = resolveComponent('UModal')
const Drawer = resolveComponent('UDrawer')
const actions = useCounterActions(() => props.branchId)
const toast = useToast()

const reasons: { value: CancelReason, label: string }[] = [
  { value: 'customer_changed_mind', label: 'The customer changed their mind' },
  { value: 'item_unavailable', label: 'An item isn\'t available' },
  { value: 'other', label: 'Other' },
]
const returnItems: { value: ReturnMethod, label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'khqr', label: 'KHQR' },
]

const reason = ref<CancelReason>('customer_changed_mind')
const note = ref('')
const returnMethod = ref<ReturnMethod>('cash')
const submitting = ref(false)
const failure = ref<{ kind: CommandFailure, message: string } | null>(null)
const noteError = ref<string>()

watch(open, (isOpen) => {
  if (!isOpen) return
  reason.value = 'customer_changed_mind'
  note.value = ''
  returnMethod.value = props.order?.payment?.method === 'khqr' ? 'khqr' : 'cash'
  failure.value = null
  noteError.value = undefined
})

const paid = computed(() => props.order?.status === 'preparing')
const refund = computed(() => {
  const payment = props.order?.payment
  if (!payment) return ''
  return payment.method === 'cash_khr' && payment.amountKhr !== null ? formatRiel(payment.amountKhr) : formatMinor(payment.amountMinor)
})

const body = computed<CancelOrderInput | null>(() => (props.order
  ? { version: props.order.version, reason: reason.value, note: note.value.trim() || null, returnMethod: paid.value ? returnMethod.value : null }
  : null))
const key = ref(crypto.randomUUID())
watch(() => JSON.stringify(body.value), () => {
  key.value = crypto.randomUUID()
})

async function submit() {
  const order = props.order
  if (!order || !body.value) return
  if (reason.value === 'other' && !note.value.trim()) {
    noteError.value = 'Say why the order is cancelled'
    return
  }
  submitting.value = true
  failure.value = null
  try {
    await actions.cancel(order, body.value, key.value)
    toast.add({ title: `Order ${orderNumber(order)} cancelled`, color: 'neutral', icon: 'i-lucide-circle-x' })
    open.value = false
    emit('cancelled')
  }
  catch (error) {
    failure.value = commandFailure(error, 'cancellation')
  }
  finally {
    submitting.value = false
  }
}

function reload() {
  failure.value = null
  open.value = false
  emit('reload')
}
</script>

<template>
  <component
    :is="isCompact ? Drawer : Modal"
    v-model:open="open"
    :title="order ? `Cancel order ${orderNumber(order)}?` : 'Cancel order?'"
    :description="paid ? 'Choose a reason and record how the money went back.' : 'Choose a reason. This can\'t be undone.'"
    :dismissible="!submitting"
    :ui="{ footer: 'flex gap-2 justify-end' }"
  >
    <template #body>
      <div class="space-y-4">
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
              ? [{ label: 'Try again', color: 'neutral', variant: 'outline', onClick: submit }]
              : failure.kind === 'changed' ? [{ label: 'Reload', color: 'neutral', variant: 'outline', onClick: reload }] : undefined"
          />
        </div>

        <URadioGroup
          v-model="reason"
          :items="reasons"
          variant="card"
          legend="Reason"
          :disabled="submitting"
        />
        <UFormField
          v-if="reason === 'other'"
          label="What happened"
          :error="noteError"
          :help="`${note.length}/${CANCEL_NOTE_MAX}`"
          required
        >
          <UTextarea
            v-model="note"
            :maxlength="CANCEL_NOTE_MAX"
            :rows="2"
            autoresize
            :disabled="submitting"
            class="w-full"
            @update:model-value="noteError = undefined"
          />
        </UFormField>

        <section
          v-if="paid"
          aria-labelledby="money-returned"
          class="space-y-2 border-t border-default pt-4"
        >
          <h3
            id="money-returned"
            class="font-semibold text-highlighted"
          >
            Money returned
          </h3>
          <UTabs
            v-model="returnMethod"
            :items="returnItems"
            :content="false"
            aria-label="How the money went back"
          />
          <p class="text-sm text-muted">
            Give back <span class="font-semibold text-highlighted">{{ refund }}</span>, the full payment.
          </p>
        </section>
      </div>
    </template>

    <template #footer>
      <UButton
        label="Keep order"
        color="neutral"
        variant="outline"
        :disabled="submitting"
        class="max-sm:flex-1 max-sm:justify-center"
        @click="open = false"
      />
      <UButton
        :label="paid ? `Cancel and return ${refund}` : 'Cancel order'"
        color="error"
        :loading="submitting"
        class="max-sm:flex-1 max-sm:justify-center"
        @click="submit"
      />
    </template>
  </component>
</template>
