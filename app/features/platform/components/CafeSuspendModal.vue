<script setup lang="ts">
/**
 * Pause a cafe (D142): why, for the platform team (customers only see that ordering is paused). The
 * cafe's customers can't order and its staff can't use the admin or the counter until it's
 * resumed; nothing is deleted.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import * as v from 'valibot'
import type { TenantDetail } from '#shared/contracts/tenants'
import { suspendTenantSchema, SUSPEND_REASON_MAX } from '#shared/contracts/tenants'
import { useCafeMutations } from '../composables/useCafes'

const props = defineProps<{ cafe: TenantDetail }>()
const emit = defineEmits<{ close: [paused: boolean] }>()

const schema = v.pick(suspendTenantSchema, ['reason'])
const state = reactive({ reason: '' })
const { suspend } = useCafeMutations()
const saving = ref(false)

async function onSubmit({ data }: FormSubmitEvent<v.InferOutput<typeof schema>>) {
  saving.value = true
  const result = await suspend.execute({ cafe: props.cafe, body: { version: props.cafe.version, reason: data.reason } })
  saving.value = false
  if (result.ok) emit('close', true)
}
</script>

<template>
  <UModal
    :title="`Pause ${cafe.name}?`"
    description="Its customers can't order and its staff can't use the admin or the counter until you resume it. Nothing is deleted."
  >
    <template #body>
      <UForm
        id="suspend-form"
        :schema="schema"
        :state="state"
        :disabled="saving"
        @submit="onSubmit"
      >
        <UFormField
          label="Reason"
          name="reason"
          help="For the platform team: customers only see that ordering is paused."
          required
        >
          <UTextarea
            v-model="state.reason"
            :maxlength="SUSPEND_REASON_MAX"
            :rows="3"
            autoresize
            autofocus
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
          @click="emit('close', false)"
        />
        <UButton
          type="submit"
          form="suspend-form"
          label="Pause cafe"
          color="error"
          :loading="saving"
        />
      </div>
    </template>
  </UModal>
</template>
