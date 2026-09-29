<script setup lang="ts">
/**
 * The account in the customer site's header (step 5.2, D97). Signed out: "Sign in" (an icon on
 * phones), coming back to this page afterwards. Signed in: the initials, opening the account:
 * name, email, whether it's verified (with "Resend email" if not), the member code to copy, and
 * "Sign out".
 *
 * The account is read in the browser only, so server-rendered pages stay the same for everyone:
 * until it's known, a placeholder the size of the button (D97).
 */
import { useClipboard } from '@vueuse/core'
import { useAccountActions, useCustomerAccount, useResendVerification } from '../composables/useCustomerAccount'
import { ACCOUNT_PATHS, accountLink, initialsOf } from '../utils/account'

const route = useRoute()
const { account, known } = useCustomerAccount()
const { signOut } = useAccountActions()
const verification = useResendVerification()
const notify = useNotify()
const { copy, copied } = useClipboard({ copiedDuring: 2000, legacy: true })
const open = ref(false)

const initials = computed(() => (account.value ? initialsOf(account.value.name, account.value.email) : ''))

async function signOutNow() {
  open.value = false
  try {
    await signOut()
    notify.success('Signed out')
  }
  catch (error) {
    notify.error('Couldn\'t sign out', error)
  }
}
</script>

<template>
  <USkeleton
    v-if="!known"
    class="size-8 shrink-0 rounded-full"
  />

  <UButton
    v-else-if="!account"
    :to="accountLink(ACCOUNT_PATHS.signIn, route.fullPath)"
    icon="i-lucide-circle-user"
    label="Sign in"
    color="neutral"
    variant="outline"
    class="shrink-0"
    :ui="{ label: 'max-sm:sr-only' }"
  />

  <UPopover
    v-else
    v-model:open="open"
    :content="{ align: 'end' }"
  >
    <UButton
      color="neutral"
      variant="ghost"
      class="shrink-0 rounded-full p-0.5"
      :aria-label="`Account: ${account.name}`"
    >
      <UAvatar
        :text="initials"
        size="sm"
      />
    </UButton>
    <template #content>
      <div class="w-72 space-y-3 p-4">
        <div class="min-w-0">
          <p class="truncate font-medium text-highlighted">
            {{ account.name }}
          </p>
          <p class="truncate text-sm text-muted">
            {{ account.email }}
          </p>
          <UBadge
            :color="account.emailVerified ? 'success' : 'warning'"
            variant="subtle"
            :label="account.emailVerified ? 'Email verified' : 'Email not verified'"
            class="mt-2"
          />
        </div>
        <div
          v-if="!account.emailVerified"
          class="space-y-2"
        >
          <p class="text-sm text-muted">
            Verify your email before placing an order.
          </p>
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
        <USeparator />
        <div>
          <p class="text-xs text-muted">
            Member code
          </p>
          <div class="flex items-center justify-between gap-2">
            <span class="font-mono text-lg text-highlighted">{{ account.memberCode }}</span>
            <UButton
              :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
              color="neutral"
              variant="ghost"
              :aria-label="copied ? 'Member code copied' : 'Copy member code'"
              @click="copy(account.memberCode)"
            />
          </div>
        </div>
        <USeparator />
        <UButton
          label="Sign out"
          icon="i-lucide-log-out"
          color="neutral"
          variant="ghost"
          block
          class="justify-start"
          @click="signOutNow"
        />
      </div>
    </template>
  </UPopover>
</template>
