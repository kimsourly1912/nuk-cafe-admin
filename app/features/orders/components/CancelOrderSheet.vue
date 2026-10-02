<script setup lang="ts">
/**
 * "Cancel order 042?" (the 6.5 frames, D114): a bottom sheet on phones, a dialog from `sm`, with
 * Keep order as the main button. Only while the order is unpaid (D45, D106). The sheet keeps its
 * own state: a refusal (paid meanwhile, or already cancelled) is shown here in the server's words
 * and the page reloads the order; a failed request can be tried again with the same key, so it
 * never cancels twice.
 */
import type { Order } from '#shared/contracts/orders'
import { cancelOrder } from '../composables/useOrders'
import { formatPickupNumber } from '../utils/order'

const props = defineProps<{ order: Pick<Order, 'id' | 'version' | 'pickupNumber'> }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ cancelled: [order: Order], changed: [] }>()

const { isCompact } = useLayoutContext()
const Modal = resolveComponent('UModal')
const Drawer = resolveComponent('AppDrawer')

const number = computed(() => formatPickupNumber(props.order.pickupNumber))
const saving = ref(false)
const error = ref<ApiError | null>(null)
/** The order changed underneath (paid or cancelled elsewhere): nothing to try again. */
const refused = computed(() => error.value?.kind === 'conflict')
let key = crypto.randomUUID()

// A new attempt each time the sheet opens; the same one for Try again.
watch(open, (value) => {
  if (!value) return
  key = crypto.randomUUID()
  error.value = null
})

async function confirm() {
  saving.value = true
  error.value = null
  try {
    const cancelled = await cancelOrder(props.order, key)
    open.value = false
    emit('cancelled', cancelled)
  }
  catch (failure) {
    error.value = ApiError.from(failure)
    if (refused.value) emit('changed')
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <component
    :is="isCompact ? Drawer : Modal"
    v-model:open="open"
    :title="`Cancel order ${number}?`"
    description="You haven't paid, so nothing is charged."
    :dismissible="!saving"
  >
    <template #body>
      <div class="space-y-4">
        <UAlert
          v-if="error"
          :color="refused ? 'neutral' : 'error'"
          variant="subtle"
          :icon="refused ? 'i-lucide-info' : 'i-lucide-circle-alert'"
          :title="getErrorMessage(error)"
        />
        <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <template v-if="refused">
            <UButton
              label="Close"
              color="neutral"
              variant="outline"
              class="justify-center"
              @click="open = false"
            />
          </template>
          <template v-else>
            <UButton
              :label="error ? 'Try again' : 'Cancel order'"
              color="error"
              variant="soft"
              class="justify-center"
              :loading="saving"
              @click="confirm"
            />
            <UButton
              label="Keep order"
              class="justify-center"
              :disabled="saving"
              @click="open = false"
            />
          </template>
        </div>
      </div>
    </template>
  </component>
</template>
