<script setup lang="ts">
/**
 * "Record the return for order #042" (D266): the cafe's owner records how a KHQR payment the order
 * couldn't take went back to the customer. How (Cash or KHQR), the currency and amount (starting
 * from what arrived), when, an optional reference and a required note with the reason and evidence.
 * Records only: nothing is sent to the customer's bank. Open via
 * `useOverlay().create(KhqrReturnModal)`; emits `close(review)` once recorded, or `close()`. A
 * refusal stays here, with Reload when another owner recorded it meanwhile. One idempotency key per
 * request: a retry of the same one never records the return twice.
 */
import type { FormError } from '@nuxt/ui'
import type { KhqrCurrency, KhqrReview, ReturnMethod } from '#shared/contracts/orders'
import { KHQR_RETURN_NOTE_MAX, KHQR_RETURN_REFERENCE_MAX } from '#shared/contracts/orders'
import { useRecordKhqrReturn } from '../composables/useExchangeRates'
import { fromMinor, khqrAmount, REVIEW_REASONS, reviewOrderNumber, toMinor } from '../utils/khqr-review'

const props = defineProps<{ review: KhqrReview }>()
const emit = defineEmits<{ 'close': [recorded?: KhqrReview], 'update:open': [open: boolean] }>()

interface ReturnForm {
  method: ReturnMethod
  currency: KhqrCurrency
  /** Dollars (with cents) for USD, riel for KHR. */
  amount: number | undefined
  /** `YYYY-MM-DDTHH:mm` in this device's time. */
  returnedAt: string
  reference: string
  note: string
}

const start = (): ReturnForm => ({
  method: 'cash',
  currency: props.review.received.currency,
  amount: fromMinor(props.review.received.currency, props.review.received.amount),
  returnedAt: localInputValue(new Date()),
  reference: '',
  note: '',
})
const state = reactive<ReturnForm>(start())
const saving = ref(false)
const { isCompact: fullscreen } = useLayoutContext()
const unsaved = useModalUnsavedChanges(state, { initial: start(), paused: saving, close: () => emit('close') })

const form = useTemplateRef('form')
useFormErrorRecheck(form)
useSubmitShortcut(() => form.value?.submit())

const methodItems: { value: ReturnMethod, label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'khqr', label: 'KHQR' },
]
const currencyItems: { value: KhqrCurrency, label: string }[] = [
  { value: 'USD', label: 'US dollars' },
  { value: 'KHR', label: 'Riel' },
]

/** The form's own checks; the server checks the same again. */
function validate(values: ReturnForm): FormError[] {
  const errors: FormError[] = []
  if (values.amount === undefined || toMinor(values.currency, values.amount) < 1) errors.push({ name: 'amount', message: 'Enter the amount given back' })
  const at = new Date(values.returnedAt)
  if (!values.returnedAt || Number.isNaN(at.getTime())) errors.push({ name: 'returnedAt', message: 'Enter when the money went back' })
  else if (at.getTime() > Date.now() + 5 * 60_000) errors.push({ name: 'returnedAt', message: 'Not in the future' })
  if (values.reference.trim().length > KHQR_RETURN_REFERENCE_MAX) errors.push({ name: 'reference', message: `At most ${KHQR_RETURN_REFERENCE_MAX} characters` })
  if (!values.note.trim()) errors.push({ name: 'note', message: 'Say why and how the money went back' })
  else if (values.note.trim().length > KHQR_RETURN_NOTE_MAX) errors.push({ name: 'note', message: `At most ${KHQR_RETURN_NOTE_MAX} characters` })
  return errors
}

// A new key for a changed request; the same one for a retry of the same request.
const key = ref(crypto.randomUUID())
watch(() => JSON.stringify(state), () => {
  key.value = crypto.randomUUID()
})

const record = useRecordKhqrReturn()
/** The last refused attempt, shown here: toasts are out of reach while the modal is open. */
const lastError = ref<{ message: string, changed: boolean }>()

async function onSubmit() {
  if (state.amount === undefined) return
  lastError.value = undefined
  saving.value = true
  const result = await record.execute({
    review: props.review,
    body: {
      version: props.review.version,
      method: state.method,
      currency: state.currency,
      amount: toMinor(state.currency, state.amount),
      returnedAt: new Date(state.returnedAt).toISOString(),
      reference: state.reference.trim() || null,
      note: state.note.trim(),
    },
    idempotencyKey: key.value,
  })
  saving.value = false
  if (!result.ok) {
    if (result.status === 'error') lastError.value = { message: result.error.message, changed: result.error.code === 'VERSION_CONFLICT' }
    return
  }
  unsaved.markClean()
  emit('close', result.data)
}

/** Another owner recorded it meanwhile: close, and the list reads it again. */
function reload() {
  unsaved.markClean()
  emit('close')
}
</script>

<template>
  <AppModal
    :title="`Record the return for order ${reviewOrderNumber(review)}`"
    description="Record the money you gave back to the customer. Nothing is sent from here."
    :fullscreen="fullscreen"
    :ui="{ footer: 'pb-[max(env(safe-area-inset-bottom),1rem)]' }"
    @update:open="unsaved.onOpenChange"
  >
    <template #body>
      <UForm
        id="khqr-return-form"
        ref="form"
        :validate="validate"
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
          title="Not recorded"
          :description="lastError.message"
          :actions="lastError.changed ? [{ label: 'Reload', color: 'neutral', variant: 'outline', onClick: reload }] : undefined"
        />
        <p class="text-sm">
          {{ REVIEW_REASONS[review.reason] }}. Bakong says
          <span class="font-semibold text-highlighted">{{ khqrAmount(review.received) }}</span> arrived.
        </p>
        <UFormField
          label="How the money went back"
          name="method"
          required
        >
          <UTabs
            v-model="state.method"
            :items="methodItems"
            :content="false"
            aria-label="How the money went back"
          />
        </UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField
            label="Currency"
            name="currency"
            required
          >
            <UTabs
              v-model="state.currency"
              :items="currencyItems"
              :content="false"
              aria-label="Currency given back"
            />
          </UFormField>
          <UFormField
            label="Amount given back"
            name="amount"
            required
          >
            <UInputNumber
              v-model="state.amount"
              :min="0"
              :step="state.currency === 'USD' ? 0.01 : 100"
              :format-options="state.currency === 'USD' ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 }"
              class="w-full"
            />
          </UFormField>
        </div>
        <UFormField
          label="When"
          name="returnedAt"
          required
          help="Your device's time."
        >
          <DateTimeInput
            v-model="state.returnedAt"
            label="When the money went back"
            :max="localInputValue(new Date())"
            :disabled="saving"
            class="w-full sm:w-72"
          />
        </UFormField>
        <UFormField
          label="Reference"
          name="reference"
          hint="Optional"
          help="The bank transfer's reference, when there is one."
        >
          <UInput
            v-model="state.reference"
            :maxlength="KHQR_RETURN_REFERENCE_MAX"
            class="w-full"
          />
        </UFormField>
        <UFormField
          label="Note"
          name="note"
          required
          :help="`${state.note.length}/${KHQR_RETURN_NOTE_MAX}`"
        >
          <UTextarea
            v-model="state.note"
            :maxlength="KHQR_RETURN_NOTE_MAX"
            :rows="2"
            autoresize
            autofocus
            placeholder="For example: paid twice, Sophea gave $8.75 back in cash at the counter"
            class="w-full"
          />
        </UFormField>
      </UForm>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="outline"
          :disabled="saving"
          class="max-sm:flex-1 max-sm:justify-center"
          @click="unsaved.requestClose()"
        />
        <UButton
          type="submit"
          form="khqr-return-form"
          label="Record return"
          :loading="saving"
          class="max-sm:flex-1 max-sm:justify-center"
        />
      </div>
    </template>
  </AppModal>
</template>
