<script setup lang="ts">
/**
 * "Verify your email to place orders" for a signed-in account that isn't verified yet (step 5.2,
 * D97), with "Resend email". Not dismissible: ordering needs it (D51). Nothing for anyone else, and
 * nothing on the server's page (the account is read in the browser).
 */
import { useCustomerAccount, useResendVerification } from '../composables/useCustomerAccount'

const { account } = useCustomerAccount()
const verification = useResendVerification()
</script>

<template>
  <UAlert
    v-if="account && !account.emailVerified"
    color="warning"
    variant="subtle"
    icon="i-lucide-mail-warning"
    title="Verify your email to place orders"
    :description="`We sent a link to ${account.email}.`"
    :actions="[{
      label: verification.label.value,
      color: 'neutral',
      variant: 'outline',
      loading: verification.sending.value,
      disabled: verification.waiting.value,
      onClick: verification.resend,
    }]"
  />
</template>
