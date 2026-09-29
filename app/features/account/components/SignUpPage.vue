<script setup lang="ts">
/**
 * Create an account (step 5.2, D97): name, email, password. The account is signed in at once and
 * Better Auth sends the verification email; next is "Check your email" (`/verify-email`), carrying
 * `?redirect=` on. An existing email or a breached password shows on its field.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import type { SignUpForm } from '../schemas/account-form'
import { signUpSchema } from '../schemas/account-form'
import { useAccountActions, useCustomerAccount } from '../composables/useCustomerAccount'
import { useAccountForm } from '../composables/useAccountForm'
import { ACCOUNT_PATHS, accountLink, accountRedirectTarget } from '../utils/account'
import AccountFrame from './AccountFrame.vue'
import FormErrorAlert from './FormErrorAlert.vue'
import PasswordInput from './PasswordInput.vue'

const route = useRoute()
const target = computed(() => accountRedirectTarget(route.query.redirect))

const state = reactive({ name: '', email: '', password: '' })
const { saving, formError, focusFirstInvalid, submit } = useAccountForm({ name: 'sign-up-name', email: 'sign-up-email', password: 'sign-up-password' })
const { signUp } = useAccountActions()

const { account, known } = useCustomerAccount()
let arrived = false
watch(known, (isKnown) => {
  if (!isKnown || arrived) return
  arrived = true
  if (account.value) navigateTo(target.value, { replace: true })
}, { immediate: true })

async function onSubmit(event: FormSubmitEvent<SignUpForm>) {
  arrived = true
  await submit(async () => {
    await signUp(event.data)
    await navigateTo(accountLink(ACCOUNT_PATHS.verifyEmail, route.query.redirect))
  })
}
</script>

<template>
  <AccountFrame
    title="Create your account"
    description="Order ahead and collect points. It takes a minute."
    :back="{ label: 'Back to the menu', to: '/' }"
  >
    <UForm
      id="sign-up-form"
      ref="form"
      :schema="signUpSchema"
      :state="state"
      class="space-y-4"
      @submit="onSubmit"
      @error="focusFirstInvalid"
    >
      <FormErrorAlert :message="formError" />

      <UFormField
        label="Name"
        name="name"
      >
        <UInput
          id="sign-up-name"
          v-model="state.name"
          autocomplete="name"
          class="w-full"
        />
      </UFormField>

      <UFormField
        label="Email"
        name="email"
      >
        <UInput
          id="sign-up-email"
          v-model="state.email"
          type="email"
          autocomplete="email"
          class="w-full"
        />
      </UFormField>

      <UFormField
        label="Password"
        name="password"
        help="At least 8 characters"
      >
        <PasswordInput
          id="sign-up-password"
          v-model="state.password"
          autocomplete="new-password"
        />
      </UFormField>
    </UForm>

    <template #footer>
      <UButton
        type="submit"
        form="sign-up-form"
        label="Create account"
        block
        :loading="saving"
      />
      <p class="text-center text-sm text-muted">
        Already have an account?
        <ULink
          :to="accountLink(ACCOUNT_PATHS.signIn, route.query.redirect)"
          class="font-medium text-primary"
        >
          Sign in
        </ULink>
      </p>
    </template>
  </AccountFrame>
</template>
