<script setup lang="ts">
/**
 * Sign in (step 5.2, D97): email and password, "Forgot password?", a link to create an account.
 * Returns to `?redirect=` (a page of the customer site) or the menu. After a password reset
 * (`?reset=1`) it says so. Someone already signed in goes straight on. With two-step sign-in (D188)
 * the password is followed by the code from the app (`<TwoFactorCodeForm>`).
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import type { SignInForm } from '../schemas/account-form'
import { signInSchema } from '../schemas/account-form'
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
const afterReset = computed(() => route.query.reset === '1')

const state = reactive({ email: '', password: '' })
const { saving, formError, submit } = useAccountForm({ email: 'sign-in-email', password: 'sign-in-password' })
const { signIn, finishSignIn } = useAccountActions()
/** After a password that needs a code: the code step replaces the form. */
const codeStep = ref(false)

const { account, known } = useAccountSession()
let arrived = false
watch(known, (isKnown) => {
  if (!isKnown || arrived) return
  arrived = true
  if (account.value) navigateTo(target.value, { replace: true })
}, { immediate: true })

async function onSubmit(event: FormSubmitEvent<SignInForm>) {
  arrived = true
  await submit(async () => {
    if (await signIn(event.data) === 'two-factor') {
      codeStep.value = true
      state.password = ''
      return
    }
    await navigateTo(target.value)
  })
}

/** The code was right: finish as after a password alone. A failure goes back to the password form. */
async function onCodeVerified() {
  codeStep.value = false
  await submit(async () => {
    await finishSignIn()
    await navigateTo(target.value)
  })
}

function restart(message?: string) {
  codeStep.value = false
  formError.value = message
}
</script>

<template>
  <AccountFrame
    title="Sign in"
    description="Sign in to order ahead and collect points."
    :back="{ label: accountBackLabel(home), to: home }"
  >
    <TwoFactorCodeForm
      v-if="codeStep"
      v-model:saving="saving"
      form-id="sign-in-code"
      @verified="onCodeVerified()"
      @restart="restart"
    />

    <UForm
      v-else
      id="sign-in-form"
      ref="form"
      :schema="signInSchema"
      :state="state"
      :validate-on="['input', 'change']"
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
        required
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
        required
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
        :form="codeStep ? 'sign-in-code' : 'sign-in-form'"
        :label="codeStep ? 'Verify' : 'Sign in'"
        block
        :loading="saving"
      />
      <UButton
        v-if="codeStep"
        label="Back"
        color="neutral"
        variant="ghost"
        block
        :disabled="saving"
        @click="restart()"
      />
      <p
        v-else
        class="text-center text-sm text-muted"
      >
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
