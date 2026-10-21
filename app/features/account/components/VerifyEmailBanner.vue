<script setup lang="ts">
/**
 * "Verify your email address" for a signed-in account that isn't verified yet (step 5.2, D97), with
 * "Resend email". Ordering doesn't wait for it (D156); a verified address is how the customer gets
 * back into the account (a password reset). Nothing for anyone else, and nothing on the server's
 * page (the account is read in the browser).
 */
import { useCustomerAccount, useResendVerification } from '../composables/useCustomerAccount'

const { account } = useCustomerAccount()
const { resend, sending, label, waiting } = useResendVerification()
</script>

<template>
  <UAlert
    v-if="account && !account.emailVerified"
    color="warning"
    variant="subtle"
    icon="i-lucide-mail-warning"
    title="Verify your email address"
    :description="`So you can always get back into your account. We sent a link to ${account.email}.`"
    :actions="[{
      label,
      color: 'neutral',
      variant: 'outline',
      loading: sending,
      disabled: waiting,
      onClick: resend,
    }]"
  />
</template>
