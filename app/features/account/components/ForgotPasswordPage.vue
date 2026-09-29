<script setup lang="ts">
/**
 * Forgot password (step 5.2, D97): the email, then "Check your email". The answer is the same
 * whether or not the email has an account (the server never says), and "Send again" waits 60 s.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import type { ForgotPasswordForm } from '../schemas/account-form'
import { forgotPasswordSchema } from '../schemas/account-form'
import { useAccountActions, useResendCooldown } from '../composables/useCustomerAccount'
import { useAccountForm } from '../composables/useAccountForm'
import { ACCOUNT_PATHS } from '../utils/account'
import AccountFrame from './AccountFrame.vue'
import FormErrorAlert from './FormErrorAlert.vue'

const state = reactive({ email: '' })
/** The address the link went to; set once sent. */
const sentTo = ref<string>()
const { saving, formError, focusFirstInvalid, submit } = useAccountForm({ email: 'forgot-email' })
const { requestPasswordReset } = useAccountActions()
const cooldown = useResendCooldown('reset')

async function send(form: ForgotPasswordForm) {
  await submit(async () => {
    await requestPasswordReset(form)
    sentTo.value = form.email
    cooldown.start()
  })
}
const onSubmit = (event: FormSubmitEvent<ForgotPasswordForm>) => send(event.data)
const sendAgain = () => send({ email: sentTo.value! })

function useAnotherEmail() {
  sentTo.value = undefined
  formError.value = undefined
}
</script>

<template>
  <AccountFrame
    v-if="!sentTo"
    title="Reset your password"
    description="Enter your account's email and we'll send you a link."
    :back="{ label: 'Back to sign in', to: ACCOUNT_PATHS.signIn }"
  >
    <UForm
      id="forgot-form"
      ref="form"
      :schema="forgotPasswordSchema"
      :state="state"
      class="space-y-4"
      @submit="onSubmit"
      @error="focusFirstInvalid"
    >
      <FormErrorAlert :message="formError" />
      <UFormField
        label="Email"
        name="email"
      >
        <UInput
          id="forgot-email"
          v-model="state.email"
          type="email"
          autocomplete="email"
          class="w-full"
        />
      </UFormField>
    </UForm>
    <template #footer>
      <UButton
        type="submit"
        form="forgot-form"
        label="Send reset link"
        block
        :loading="saving"
      />
    </template>
  </AccountFrame>

  <AccountFrame
    v-else
    title="Check your email"
    icon="i-lucide-mail"
    :back="{ label: 'Back to sign in', to: ACCOUNT_PATHS.signIn }"
  >
    <template #description>
      <p class="mt-1 text-sm text-muted">
        If an account exists for <span class="font-medium break-all text-highlighted">{{ sentTo }}</span>, we've sent a link. It works once, for 1 hour.
      </p>
    </template>
    <div class="space-y-4 text-center">
      <p class="text-sm text-muted">
        It can take a minute to arrive; check your spam folder too.
      </p>
      <FormErrorAlert :message="formError" />
    </div>
    <template #footer>
      <UButton
        :label="cooldown.secondsLeft.value ? `Send again in ${cooldown.secondsLeft.value} s` : 'Send again'"
        color="neutral"
        variant="outline"
        block
        :loading="saving"
        :disabled="cooldown.secondsLeft.value > 0"
        @click="sendAgain"
      />
      <UButton
        label="Use another email"
        color="neutral"
        variant="ghost"
        block
        @click="useAnotherEmail"
      />
    </template>
  </AccountFrame>
</template>
