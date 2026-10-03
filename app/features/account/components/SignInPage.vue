<script setup lang="ts">
/**
 * Sign in (step 5.2, D97): email and password, "Forgot password?", a link to create an account.
 * Returns to `?redirect=` (a page of the customer site) or the menu. After a password reset
 * (`?reset=1`) it says so. Someone already signed in goes straight on.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import type { SignInForm } from '../schemas/account-form'
import { signInSchema } from '../schemas/account-form'
import { useAccountActions, useCustomerAccount } from '../composables/useCustomerAccount'
import { useAccountForm } from '../composables/useAccountForm'
import { ACCOUNT_PATHS, accountLink, accountRedirectTarget } from '../utils/account'
import { useAccountHome } from '../composables/useAccountHome'
import AccountFrame from './AccountFrame.vue'
import FormErrorAlert from './FormErrorAlert.vue'
import PasswordInput from './PasswordInput.vue'

const route = useRoute()
const home = useAccountHome()
const target = computed(() => accountRedirectTarget(route.query.redirect, home.value))
const afterReset = computed(() => route.query.reset === '1')

const state = reactive({ email: '', password: '' })
const { saving, formError, focusFirstInvalid, submit } = useAccountForm({ email: 'sign-in-email', password: 'sign-in-password' })
const { signIn } = useAccountActions()

const { account, known } = useCustomerAccount()
let arrived = false
watch(known, (isKnown) => {
  if (!isKnown || arrived) return
  arrived = true
  if (account.value) navigateTo(target.value, { replace: true })
}, { immediate: true })

async function onSubmit(event: FormSubmitEvent<SignInForm>) {
  arrived = true
  await submit(async () => {
    await signIn(event.data)
    await navigateTo(target.value)
  })
}
</script>

<template>
  <AccountFrame
    title="Sign in"
    description="Sign in to order ahead and collect points."
    :back="{ label: 'Back to the menu', to: home }"
  >
    <UForm
      id="sign-in-form"
      ref="form"
      :schema="signInSchema"
      :state="state"
      class="space-y-4"
      @submit="onSubmit"
      @error="focusFirstInvalid"
    >
      <UAlert
        v-if="afterReset && !formError"
        color="success"
        variant="subtle"
        icon="i-lucide-circle-check"
        title="Password changed. Sign in with your new password."
      />
      <FormErrorAlert :message="formError" />

      <UFormField
        label="Email"
        name="email"
      >
        <UInput
          id="sign-in-email"
          v-model="state.email"
          type="email"
          autocomplete="username"
          class="w-full"
        />
      </UFormField>

      <UFormField
        label="Password"
        name="password"
      >
        <PasswordInput
          id="sign-in-password"
          v-model="state.password"
          autocomplete="current-password"
        />
      </UFormField>
      <div class="-mt-2 flex justify-end">
        <ULink
          :to="ACCOUNT_PATHS.forgotPassword"
          class="text-sm text-primary"
        >
          Forgot password?
        </ULink>
      </div>
    </UForm>

    <template #footer>
      <UButton
        type="submit"
        form="sign-in-form"
        label="Sign in"
        block
        :loading="saving"
      />
      <p class="text-center text-sm text-muted">
        New here?
        <ULink
          :to="accountLink(ACCOUNT_PATHS.signUp, route.query.redirect)"
          class="font-medium text-primary"
        >
          Create an account
        </ULink>
      </p>
    </template>
  </AccountFrame>
</template>
