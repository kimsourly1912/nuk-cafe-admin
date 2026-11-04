<script setup lang="ts">
/**
 * Sign in (step 5.2, D97): email and password, "Forgot password?", a link to create an account.
 * Returns to `?redirect=` (a page of the customer site) or the menu. After a password reset
 * (`?reset=1`) it says so. Someone already signed in goes straight on, never seeing the form: a
 * skeleton shows until the browser knows (D238). With two-step sign-in (D188)
 * the password is followed by the code from the app (`<TwoFactorCodeForm>`). A staff account on its
 * temporary password stays signed in and gets a link to its workspace's change-password page (Q3,
 * D241).
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import type { SignInForm } from '../schemas/account-form'
import { signInSchema } from '../schemas/account-form'
import { useAccountActions, useAccountSession } from '../composables/useCustomerAccount'
import { useAccountForm } from '../composables/useAccountForm'
import type { ChangePasswordTarget } from '~/utils/account-cafes'
import { ACCOUNT_ASIDES, ACCOUNT_PATHS, accountBackLabel, accountLink, accountRedirectTarget, TemporaryPasswordError } from '../utils/account'
import { useAccountHome } from '../composables/useAccountHome'
import AccountAside from './AccountAside.vue'
import AccountFrame from './AccountFrame.vue'
import FormErrorAlert from './FormErrorAlert.vue'
import PasswordInput from './PasswordInput.vue'
import { useAccountProviders } from '../composables/useAccountProviders'
import { useGoogleSignInPopup } from '../composables/useGoogleSignInPopup'
import { googleSignInError } from '../utils/google-sign-in'

const route = useRoute()
const { googleEnabled, known: providersKnown, error: providersError, refresh: refreshProviders } = useAccountProviders()
const home = useAccountHome()
const target = computed(() => accountRedirectTarget(route.query.redirect, home.value))
// Display only our own bounded text; never render the provider's raw error/description.
const googleError = computed(() => route.query.error ? googleSignInError(route.query.error) : undefined)
const identity = useSessionIdentity()
const afterReset = computed(() => route.query.reset === '1')

const state = reactive({ email: '', password: '' })
const { saving, formError, submit } = useAccountForm({ formId: 'sign-in-form', fields: ['email', 'password'] }, state)
const { signIn, finishSignIn } = useAccountActions()
const assertActive = useAuthCompletion()
const googlePopup = useGoogleSignInPopup()
/** After a password that needs a code: the code step replaces the form. */
const codeStep = ref(route.query.googleTwoFactor === '1')
/** A temporary password (Q3): where to change it, linked under the message. */
const changePasswordAt = ref<ChangePasswordTarget | null>(null)

/** Signs in, keeping a temporary password's way on; the message itself is `submit`'s. */
async function signInAnd(step: () => Promise<void>) {
  changePasswordAt.value = null
  try {
    await step()
  }
  catch (error) {
    if (error instanceof TemporaryPasswordError) changePasswordAt.value = error.target
    throw error
  }
}

const { account, known, error: sessionError, refresh } = useAccountSession({ fresh: true })
/** Already signed in on arrival: on its way on, so the form never shows (D238). */
const leaving = ref(false)
watch([known, account], async ([isKnown, current]) => {
  if (isKnown && current && !saving.value && !leaving.value) {
    leaving.value = true
    try {
      if (route.query.google === '1') {
        await identity.change('login', 'account')
        assertActive()
      }
      await navigateTo(target.value, { replace: true })
    }
    finally {
      leaving.value = false
    }
  }
}, { immediate: true })
const loading = computed(() => (!known.value && !sessionError.value && !saving.value) || (!providersKnown.value && !providersError.value) || leaving.value)

async function onGoogleSignIn() {
  if (saving.value) return
  await submit(async () => {
    const step = await googlePopup.open(route.query.redirect)
    if (step === 'two-factor') {
      codeStep.value = true
      state.password = ''
      return
    }
    assertActive()
    await navigateTo(target.value)
  })
}

async function onSubmit(event: FormSubmitEvent<SignInForm>) {
  if (saving.value) return
  await submit(() => signInAnd(async () => {
    const step = await signIn(event.data)
    assertActive()
    if (step === 'two-factor') {
      codeStep.value = true
      state.password = ''
      return
    }
    await navigateTo(target.value)
  }))
}

/** The code was right: finish as after a password alone. A failure goes back to the password form. */
async function onCodeVerified() {
  let completed = false
  await submit(() => signInAnd(async () => {
    await finishSignIn()
    assertActive()
    await navigateTo(target.value)
    completed = true
  }))
  if (!completed) codeStep.value = false
}

function restart(message?: string) {
  codeStep.value = false
  formError.value = message
}
</script>

<template>
  <TaskFrameSkeleton
    v-if="loading"
    :fields="2"
  >
    <template #aside>
      <AccountAside v-bind="ACCOUNT_ASIDES.signIn" />
    </template>
  </TaskFrameSkeleton>
  <SessionCheckError
    v-else-if="sessionError && !known && !saving"
    :error="sessionError"
    @retry="refresh()"
  >
    <template #aside>
      <AccountAside v-bind="ACCOUNT_ASIDES.signIn" />
    </template>
  </SessionCheckError>
  <AccountFrame
    v-else
    title="Sign in"
    description="Sign in to order ahead and collect points."
    :aside="ACCOUNT_ASIDES.signIn"
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
      :disabled="saving"
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
      <FormErrorAlert :message="formError || googleError" />
      <ApiErrorAlert
        v-if="providersError"
        title="Could not check Google sign-in"
        :error="providersError"
        @retry="refreshProviders()"
      />
      <GoogleSignInButton
        :enabled="googleEnabled"
        :disabled="saving"
        :pending="googlePopup.pending.value"
        @click="onGoogleSignIn"
      />
      <!-- A full page load: the workspace reads its own session (D141). -->
      <UButton
        v-if="changePasswordAt && formError"
        label="Change password"
        icon="i-lucide-key-round"
        :to="changePasswordAt.path"
        external
        block
      />

      <UFormField
        label="Email"
        name="email"
        required
      >
        <UInput
          v-model="state.email"
          type="email"
          autocomplete="username"
          icon="i-lucide-mail"
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
          :to="accountLink(ACCOUNT_PATHS.forgotPassword, route.query.redirect)"
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
        :loading="saving && !googlePopup.pending.value"
        :disabled="saving"
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
