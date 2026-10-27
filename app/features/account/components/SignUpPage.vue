<script setup lang="ts">
/**
 * Create an account (step 5.2, D97): name, email, password. The account is signed in at once and
 * Better Auth sends the verification email; next is "Check your email" (`/verify-email`), carrying
 * `?redirect=` on. An existing email or a breached password shows on its field.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import type { SignUpForm } from '../schemas/account-form'
import { signUpSchema } from '../schemas/account-form'
import { useAccountActions, useAccountSession } from '../composables/useCustomerAccount'
import { useAccountForm } from '../composables/useAccountForm'
import { ACCOUNT_PATHS, accountBackLabel, accountLink, accountRedirectTarget } from '../utils/account'
import { useAccountHome } from '../composables/useAccountHome'
import AccountFrame from './AccountFrame.vue'
import FormErrorAlert from './FormErrorAlert.vue'
import PasswordInput from './PasswordInput.vue'

const route = useRoute()
const home = useAccountHome()
const target = computed(() => accountRedirectTarget(route.query.redirect, home.value))

const state = reactive({ name: '', email: '', password: '' })
const { saving, formError, submit } = useAccountForm({ name: 'sign-up-name', email: 'sign-up-email', password: 'sign-up-password' })
const { signUp } = useAccountActions()

const { account, known } = useAccountSession()
let arrived = false
watch(known, (isKnown) => {
  if (!isKnown || arrived) return
  arrived = true
  if (account.value) navigateTo(target.value, { replace: true })
}, { immediate: true })

/** The password the server refused as breached, for the checklist. */
const refusedPassword = ref<string>()
/** The last password Generate made: random, so the checklist skips its leaked-password check. */
const generatedPassword = ref<string>()

async function onSubmit(event: FormSubmitEvent<SignUpForm>) {
  arrived = true
  await submit(async () => {
    try {
      await signUp(event.data, route.query.redirect)
    }
    catch (error) {
      if (isBreachedPassword(error)) refusedPassword.value = event.data.password
      throw error
    }
    await navigateTo(accountLink(ACCOUNT_PATHS.verifyEmail, route.query.redirect))
  })
}
</script>

<template>
  <AccountFrame
    title="Create your account"
    description="Order ahead and collect points. It takes a minute."
    :back="{ label: accountBackLabel(home), to: home }"
  >
    <UForm
      id="sign-up-form"
      ref="form"
      :schema="signUpSchema"
      :state="state"
      :validate-on="['input', 'change']"
      class="space-y-4"
      @submit="onSubmit"
      @error="focusFirstInvalid"
    >
      <FormErrorAlert :message="formError" />

      <UFormField
        label="Name"
        name="name"
        required
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
        required
      >
        <UInput
          id="sign-up-email"
          v-model="state.email"
          type="email"
          autocomplete="email"
          class="w-full"
        />
      </UFormField>

      <div class="space-y-2">
        <UFormField
          label="Password"
          name="password"
          required
        >
          <PasswordInput
            id="sign-up-password"
            v-model="state.password"
            autocomplete="new-password"
            @generate="generatedPassword = $event"
          />
        </UFormField>
        <PasswordRequirements
          :password="state.password"
          :refused="refusedPassword"
          :generated="generatedPassword"
        />
      </div>
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
