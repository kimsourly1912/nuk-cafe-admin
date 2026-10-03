<script setup lang="ts">
/**
 * What stops "Place order" before it's sent (D100, the owner's mockups): not signed in (sign in or
 * create an account, then back to Review order: the order stays on this device), or signed in with
 * an email that isn't verified yet (resend the link; "I've verified" checks again). A dialog from
 * `sm`, a bottom sheet on phones.
 */
import { ACCOUNT_PATHS, accountLink, useCustomerAccount, useResendVerification } from '~/features/account'

const tenantPath = useTenantPath()

const open = defineModel<'sign-in' | 'verify' | null>({ required: true })
const emit = defineEmits<{ verified: [] }>()

const { isCompact } = useLayoutContext()
// A dialog from `sm`, a bottom sheet on phones: the same content in either.
const Modal = resolveComponent('UModal')
const Drawer = resolveComponent('AppDrawer')
const { account, refresh } = useCustomerAccount()
const verification = useResendVerification()
const checking = ref(false)
const stillUnverified = ref(false)

const shown = computed({
  get: () => open.value !== null,
  set: (value: boolean) => {
    if (!value) open.value = null
  },
})

async function checkVerified() {
  checking.value = true
  stillUnverified.value = false
  try {
    await refresh()
    if (account.value?.emailVerified) {
      open.value = null
      emit('verified')
    }
    else {
      stillUnverified.value = true
    }
  }
  finally {
    checking.value = false
  }
}
</script>

<template>
  <component
    :is="isCompact ? Drawer : Modal"
    v-model:open="shown"
    :title="open === 'verify' ? 'Verify your email to place orders' : 'Sign in to place your order'"
    :close="false"
    :ui="{ header: 'sr-only' }"
  >
    <!-- The dialog's title (hidden, it names the dialog) is shown again under the icon. No X: it would be
         hidden with the header; a tap outside or Escape closes it. -->
    <template #body>
      <div class="flex flex-col items-center gap-3 p-2 text-center">
        <UIcon
          :name="open === 'verify' ? 'i-lucide-mail-warning' : 'i-lucide-circle-user'"
          class="size-10 text-primary"
        />
        <template v-if="open === 'verify'">
          <p
            class="text-lg font-semibold text-highlighted"
            aria-hidden="true"
          >
            Verify your email to place orders
          </p>
          <p class="text-sm text-muted">
            We sent a link to <span class="font-medium text-highlighted">{{ account?.email }}</span>. Open it, then come back to place your order.
          </p>
          <p
            v-if="stillUnverified"
            class="text-sm text-warning"
            role="status"
          >
            Not verified yet. Open the link in the email first.
          </p>
          <div class="grid w-full gap-2">
            <UButton
              label="I've verified, continue"
              block
              :loading="checking"
              @click="checkVerified"
            />
            <UButton
              :label="verification.label.value"
              color="neutral"
              variant="outline"
              block
              :loading="verification.sending.value"
              :disabled="verification.waiting.value"
              @click="verification.resend"
            />
          </div>
        </template>
        <template v-else>
          <p
            class="text-lg font-semibold text-highlighted"
            aria-hidden="true"
          >
            Sign in to place your order
          </p>
          <p class="text-sm text-muted">
            Your order is saved on this device. You'll come back here after signing in.
          </p>
          <div class="grid w-full gap-2">
            <UButton
              label="Sign in"
              :to="accountLink(ACCOUNT_PATHS.signIn, tenantPath('/checkout'))"
              block
            />
            <UButton
              label="Create account"
              :to="accountLink(ACCOUNT_PATHS.signUp, tenantPath('/checkout'))"
              color="neutral"
              variant="outline"
              block
            />
          </div>
        </template>
      </div>
    </template>
  </component>
</template>
