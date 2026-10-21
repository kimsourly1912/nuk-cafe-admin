<script setup lang="ts">
/**
 * Choose a new password (step 5.2, D97), where the reset link lands: Better Auth checked the link
 * and sent `?token=`, or `?error=INVALID_TOKEN` (expired or used; the page doesn't tell them apart,
 * the server doesn't either). One password field with a show button, no "confirm". Saving signs the
 * account out everywhere and goes to sign-in, which says the password changed.
 *
 * The token leaves the address bar once read, so it isn't kept in the history or sent on as a
 * referrer.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import type { ResetPasswordForm } from '../schemas/account-form'
import { resetPasswordSchema } from '../schemas/account-form'
import { useAccountActions } from '../composables/useCustomerAccount'
import { useAccountForm } from '../composables/useAccountForm'
import { ACCOUNT_PATHS, isDeadLink } from '../utils/account'
import AccountFrame from './AccountFrame.vue'
import FormErrorAlert from './FormErrorAlert.vue'
import PasswordInput from './PasswordInput.vue'

const route = useRoute()
const token = useState<string | undefined>('account:reset-token', () => undefined)
if (typeof route.query.token === 'string') token.value = route.query.token
const dead = ref(typeof route.query.error === 'string' || !token.value)

onMounted(() => {
  if (route.query.token) navigateTo({ query: {} }, { replace: true })
})

const state = reactive({ password: '' })
const { saving, formError, focusFirstInvalid, submit } = useAccountForm({ password: 'reset-password' })
const { resetPassword } = useAccountActions()

async function onSubmit(event: FormSubmitEvent<ResetPasswordForm>) {
  let deadNow = false
  await submit(async () => {
    try {
      await resetPassword(token.value!, event.data.password)
    }
    catch (error) {
      if (!isDeadLink(error)) throw error
      deadNow = true
      return
    }
    token.value = undefined
    await navigateTo({ path: ACCOUNT_PATHS.signIn, query: { reset: '1' } })
  })
  if (deadNow) dead.value = true
}
</script>

<template>
  <AccountFrame
    v-if="dead"
    title="This link doesn't work anymore"
    description="Reset links work once, for 1 hour."
    icon="i-lucide-link-2-off"
    icon-color="warning"
    :back="{ label: 'Back to sign in', to: ACCOUNT_PATHS.signIn }"
  >
    <template #footer>
      <UButton
        :to="ACCOUNT_PATHS.forgotPassword"
        label="Send a new link"
        block
      />
    </template>
  </AccountFrame>

  <AccountFrame
    v-else
    title="Choose a new password"
    :back="{ label: 'Back to sign in', to: ACCOUNT_PATHS.signIn }"
  >
    <UForm
      id="reset-form"
      ref="form"
      :schema="resetPasswordSchema"
      :state="state"
      class="space-y-4"
      @submit="onSubmit"
      @error="focusFirstInvalid"
    >
      <FormErrorAlert :message="formError" />
      <UFormField
        label="New password"
        name="password"
        help="At least 8 characters"
      >
        <PasswordInput
          id="reset-password"
          v-model="state.password"
          autocomplete="new-password"
        />
      </UFormField>
      <UAlert
        color="neutral"
        variant="subtle"
        icon="i-lucide-info"
        title="You'll be signed out on your other devices."
      />
    </UForm>
    <template #footer>
      <UButton
        type="submit"
        form="reset-form"
        label="Save password"
        block
        :loading="saving"
      />
    </template>
  </AccountFrame>
</template>
