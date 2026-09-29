<script setup lang="ts">
/**
 * Where the verification link lands (step 5.2, D97). Better Auth has verified the email and signed
 * the person in, or sent `?error=` (the link expired, was already replaced, or isn't ours: the page
 * says "doesn't work anymore" for all of them). A new link comes from here when signed in, else
 * after signing in.
 */
import { useAccountActions, useCustomerAccount, useResendCooldown } from '../composables/useCustomerAccount'
import { useAccountForm } from '../composables/useAccountForm'
import { ACCOUNT_PATHS, accountLink } from '../utils/account'
import AccountFrame from './AccountFrame.vue'
import FormErrorAlert from './FormErrorAlert.vue'

const route = useRoute()
const failed = computed(() => typeof route.query.error === 'string')

const { account, known } = useCustomerAccount()
const { resendVerification } = useAccountActions()
const cooldown = useResendCooldown('verify')
const { saving, formError, submit } = useAccountForm({})
const sent = ref(false)

async function sendNewLink() {
  if (!account.value) return
  await submit(async () => {
    await resendVerification(account.value!.email)
    sent.value = true
    cooldown.start()
  })
}
</script>

<template>
  <AccountFrame
    v-if="!failed || account?.emailVerified"
    title="Email verified"
    :description="account ? `You're signed in as ${account.name}.` : 'You can order as soon as the cafe is open.'"
    icon="i-lucide-circle-check"
    icon-color="success"
  >
    <template #footer>
      <UButton
        to="/"
        label="Back to the menu"
        block
      />
    </template>
  </AccountFrame>

  <AccountFrame
    v-else
    title="This link doesn't work anymore"
    description="Verification links work for 24 hours, and only the newest one works."
    icon="i-lucide-link-2-off"
    icon-color="warning"
    :back="{ label: 'Back to the menu', to: '/' }"
  >
    <div
      v-if="sent || formError"
      class="space-y-4"
    >
      <FormErrorAlert :message="formError" />
      <UAlert
        v-if="sent && !formError"
        color="success"
        variant="subtle"
        icon="i-lucide-circle-check"
        :title="`We sent a new link to ${account?.email}.`"
        role="status"
      />
    </div>
    <template #footer>
      <UButton
        v-if="known && account"
        :label="cooldown.secondsLeft.value ? `Send a new link in ${cooldown.secondsLeft.value} s` : 'Send a new link'"
        block
        :loading="saving"
        :disabled="cooldown.secondsLeft.value > 0"
        @click="sendNewLink"
      />
      <UButton
        v-else
        :to="accountLink(ACCOUNT_PATHS.signIn, ACCOUNT_PATHS.verifyEmail)"
        label="Sign in to get a new link"
        block
        :loading="!known"
      />
    </template>
  </AccountFrame>
</template>
