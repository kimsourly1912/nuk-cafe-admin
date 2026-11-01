<script setup lang="ts">
/**
 * Turns off two-step sign-in for someone who lost both the authenticator app and the backup codes
 * (QA1, D247). First why, for the platform team (how you checked it's really them); then the server
 * asks for the super admin's own password ("Confirm it's you", D246). Every device they use is
 * signed out; they sign in with their password alone and can turn it on again from Account security.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import * as v from 'valibot'
import type { PlatformAccountDetail } from '#shared/contracts/accounts'
import { ACCOUNT_REASON_MAX, turnOffTwoFactorSchema } from '#shared/contracts/accounts'
import { useAccountMutations } from '../composables/useAccounts'

const props = defineProps<{ account: PlatformAccountDetail }>()
const emit = defineEmits<{ close: [] }>()

const schema = v.pick(turnOffTwoFactorSchema, ['reason'])
const state = reactive({ reason: '' })
const form = useTemplateRef('form')
useFormErrorRecheck(form)
const { turnOffTwoFactor } = useAccountMutations()

async function onSubmit({ data }: FormSubmitEvent<v.InferOutput<typeof schema>>) {
  const result = await turnOffTwoFactor.execute({ account: props.account, body: { version: props.account.version, reason: data.reason } })
  if (result.ok) emit('close')
}
</script>

<template>
  <AppModal
    :title="`Turn off two-step sign-in for ${account.name}?`"
    description="Only when they lost both their authenticator app and their backup codes. Every device they use is signed out, and they sign in with their password alone until they turn it on again."
    :dismissible="!turnOffTwoFactor.pending"
  >
    <template #body>
      <UForm
        id="two-factor-off-account-form"
        ref="form"
        :schema="schema"
        :state="state"
        :disabled="turnOffTwoFactor.pending"
        @submit="onSubmit"
        @error="focusFirstInvalid"
      >
        <UFormField
          label="Reason"
          name="reason"
          help="For the platform team: how you checked it's really them."
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
      </UForm>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="outline"
          :disabled="turnOffTwoFactor.pending"
          @click="emit('close')"
        />
        <UButton
          type="submit"
          form="two-factor-off-account-form"
          label="Turn off two-step sign-in"
          color="error"
          :loading="turnOffTwoFactor.pending"
        />
      </div>
    </template>
  </AppModal>
</template>
