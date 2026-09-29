<script setup lang="ts">
/**
 * "Check your email" (step 5.2, D97), after creating an account or from the unverified banner:
 * where the link went, how long it works, and "Resend email" with a 60 s wait between sends.
 * Already verified says so; signed out offers sign-in (the page is about the signed-in account).
 */
import { useAccountActions, useCustomerAccount, useResendCooldown } from '../composables/useCustomerAccount'
import { useAccountForm } from '../composables/useAccountForm'
import { ACCOUNT_PATHS, accountLink, accountRedirectTarget } from '../utils/account'
import AccountFrame from './AccountFrame.vue'
import FormErrorAlert from './FormErrorAlert.vue'

const route = useRoute()
const target = computed(() => accountRedirectTarget(route.query.redirect))

const { account, known } = useCustomerAccount()
const { resendVerification } = useAccountActions()
const cooldown = useResendCooldown('verify')
const { saving, formError, submit } = useAccountForm({})
const sentAgain = ref(false)

async function resend() {
  if (!account.value) return
  sentAgain.value = false
  await submit(async () => {
    await resendVerification(account.value!.email)
    sentAgain.value = true
    cooldown.start()
  })
}
</script>

<template>
  <div
    v-if="!known"
    class="max-sm:flex-1 max-sm:bg-default"
  >
    <UCard class="w-full max-sm:rounded-none max-sm:ring-0">
      <div
        class="space-y-3"
        aria-busy="true"
        aria-label="Loading your account"
      >
        <USkeleton class="mx-auto size-10 rounded-full" />
        <USkeleton class="mx-auto h-6 w-40" />
        <USkeleton class="h-4 w-full" />
      </div>
    </UCard>
  </div>

  <AccountFrame
    v-else-if="!account"
    title="Sign in to verify your email"
    description="Sign in to the account you created, then we can send a new link."
    icon="i-lucide-mail"
    :back="{ label: 'Back to the menu', to: '/' }"
  >
    <template #footer>
      <UButton
        :to="accountLink(ACCOUNT_PATHS.signIn, ACCOUNT_PATHS.verifyEmail)"
        label="Sign in"
        block
      />
    </template>
  </AccountFrame>

  <AccountFrame
    v-else-if="account.emailVerified"
    title="Your email is verified"
    :description="`You're signed in as ${account.name}.`"
    icon="i-lucide-circle-check"
    icon-color="success"
  >
    <template #footer>
      <UButton
        :to="target"
        label="Back to the menu"
        block
      />
    </template>
  </AccountFrame>

  <AccountFrame
    v-else
    title="Check your email"
    icon="i-lucide-mail"
    :back="{ label: 'Back to the menu', to: target }"
  >
    <template #description>
      <p class="mt-1 text-highlighted">
        We sent a link to <span class="font-medium break-all">{{ account.email }}</span>
      </p>
    </template>
    <div class="space-y-4 text-center">
      <p class="text-sm text-muted">
        Open it to verify your email. It works for 24 hours. It can take a minute to arrive; check your spam folder too.
      </p>
      <FormErrorAlert :message="formError" />
      <UAlert
        v-if="sentAgain && !formError"
        color="success"
        variant="subtle"
        icon="i-lucide-circle-check"
        title="Sent again."
        role="status"
      />
    </div>
    <template #footer>
      <UButton
        :label="cooldown.secondsLeft.value ? `Resend email in ${cooldown.secondsLeft.value} s` : 'Resend email'"
        color="neutral"
        variant="outline"
        block
        :loading="saving"
        :disabled="cooldown.secondsLeft.value > 0"
        @click="resend"
      />
      <UButton
        :to="target"
        label="Back to the menu"
        block
      />
    </template>
  </AccountFrame>
</template>
