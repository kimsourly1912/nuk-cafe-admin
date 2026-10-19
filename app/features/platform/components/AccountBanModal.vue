<script setup lang="ts">
/**
 * Ban an account (step P1, D187): why, for the platform team, and for how long. The account can't
 * sign in anywhere and every device is signed out at once. A cafe it is the only owner of keeps
 * running without an owner who can sign in (D186): the dialog names those cafes first.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import * as v from 'valibot'
import type { PlatformAccountDetail } from '#shared/contracts/accounts'
import { ACCOUNT_REASON_MAX, banAccountSchema } from '#shared/contracts/accounts'
import { useAccountMutations } from '../composables/useAccounts'
import { BAN_DURATIONS, banUntil } from '../schemas/account-form'
import type { BanDuration } from '../schemas/account-form'

const props = defineProps<{ account: PlatformAccountDetail }>()
const emit = defineEmits<{ close: [banned: boolean] }>()

const schema = v.object({
  reason: banAccountSchema.entries.reason,
  duration: v.picklist(BAN_DURATIONS.map(d => d.value)),
})
const state = reactive<{ reason: string, duration: BanDuration }>({ reason: '', duration: 'forever' })
const form = useTemplateRef('form')
useFormErrorRecheck(form)
const { ban } = useAccountMutations()
const saving = ref(false)

const ownerless = computed(() => props.account.cafes.filter(cafe => cafe.onlyActiveOwner))
const durations = BAN_DURATIONS.map(d => ({ label: d.label, value: d.value }))

async function onSubmit({ data }: FormSubmitEvent<v.InferOutput<typeof schema>>) {
  saving.value = true
  const result = await ban.execute({ account: props.account, body: { version: props.account.version, reason: data.reason, until: banUntil(data.duration) } })
  saving.value = false
  if (result.ok) emit('close', true)
}
</script>

<template>
  <UModal
    :title="`Ban ${account.name}?`"
    description="They can't sign in anywhere, and every device they use is signed out now. Nothing is deleted."
  >
    <template #body>
      <div class="space-y-4">
        <UAlert
          v-if="ownerless.length"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="These cafes will have no owner who can sign in"
          :description="`${ownerless.map(cafe => cafe.name).join(', ')} keeps taking orders, but nobody can change its menu, staff or payments until it has an owner again.`"
          data-testid="ownerless-warning"
        />
        <UForm
          id="ban-form"
          ref="form"
          :schema="schema"
          :state="state"
          :disabled="saving"
          class="space-y-4"
          @submit="onSubmit"
          @error="focusFirstInvalid"
        >
          <UFormField
            label="Reason"
            name="reason"
            help="For the platform team: it isn't shown to them."
            required
          >
            <UTextarea
              v-model="state.reason"
              :maxlength="ACCOUNT_REASON_MAX"
              :rows="3"
              autoresize
              autofocus
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="How long"
            name="duration"
          >
            <URadioGroup
              v-model="state.duration"
              :items="durations"
            />
          </UFormField>
        </UForm>
      </div>
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
          form="ban-form"
          label="Ban account"
          color="error"
          :loading="saving"
        />
      </div>
    </template>
  </UModal>
</template>
