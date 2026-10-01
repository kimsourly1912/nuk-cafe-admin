<script setup lang="ts">
/**
 * The account in the customer site's header (step 5.2, D97; revised in D124).
 * - Signed out: from `lg`, "Sign in", coming back to this page afterwards; below `lg` an icon
 *   opening Sign in, Create account and Appearance (the header has no light/dark button there).
 * - Signed in: the initials, opening the account: name, email, whether it's verified (with
 *   "Resend email" if not), the member code to copy, Your orders, the staff workspaces the server
 *   says this account may open (the admin app, the counter), Appearance below `lg`, and Sign out.
 *
 * Which signed-out button shows is CSS (both are rendered).
 *
 * The account is read in the browser only, so server-rendered pages stay the same for everyone:
 * until it's known, a placeholder the size of the button (D97).
 */
import { useClipboard } from '@vueuse/core'
import { useAccountActions, useCustomerAccount, useResendVerification } from '../composables/useCustomerAccount'
import { ACCOUNT_PATHS, accountLink, initialsOf } from '../utils/account'
import AppearanceChoice from './AppearanceChoice.vue'

const route = useRoute()
const { account, known } = useCustomerAccount()
const { signOut } = useAccountActions()
const verification = useResendVerification()
const notify = useNotify()
const { copy, copied } = useClipboard({ copiedDuring: 2000, legacy: true })
const open = ref(false)
const guestOpen = ref(false)

const WORKSPACE_LINKS = {
  admin: { label: 'Admin workspace', icon: 'i-lucide-layout-dashboard', to: '/admin' },
  counter: { label: 'Counter', icon: 'i-lucide-store', to: '/counter' },
} as const
const workspaces = computed(() => (account.value?.workspaces ?? []).map(id => ({ id, ...WORKSPACE_LINKS[id] })))

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

  <template v-else-if="!account">
    <UButton
      :to="accountLink(ACCOUNT_PATHS.signIn, route.fullPath)"
      icon="i-lucide-circle-user"
      label="Sign in"
      color="neutral"
      variant="outline"
      class="shrink-0 max-lg:hidden"
    />
    <UPopover
      v-model:open="guestOpen"
      :content="{ align: 'end' }"
    >
      <UButton
        icon="i-lucide-circle-user"
        color="neutral"
        variant="ghost"
        class="shrink-0 lg:hidden"
        aria-label="Account"
      />
      <template #content>
        <div class="w-60 space-y-1 p-2">
          <UButton
            label="Sign in"
            icon="i-lucide-log-in"
            :to="accountLink(ACCOUNT_PATHS.signIn, route.fullPath)"
            color="neutral"
            variant="ghost"
            block
            class="justify-start"
            @click="guestOpen = false"
          />
          <UButton
            label="Create account"
            icon="i-lucide-user-plus"
            :to="accountLink(ACCOUNT_PATHS.signUp, route.fullPath)"
            color="neutral"
            variant="ghost"
            block
            class="justify-start"
            @click="guestOpen = false"
          />
          <USeparator class="my-1" />
          <AppearanceChoice />
        </div>
      </template>
    </UPopover>
  </template>

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
          label="Your orders"
          icon="i-lucide-receipt"
          to="/orders"
          color="neutral"
          variant="ghost"
          block
          class="justify-start"
          @click="open = false"
        />
        <template v-if="workspaces.length">
          <USeparator />
          <div>
            <p class="px-2 pb-1 text-xs text-muted">
              Workspaces
            </p>
            <UButton
              v-for="workspace in workspaces"
              :key="workspace.id"
              :label="workspace.label"
              :icon="workspace.icon"
              :to="workspace.to"
              color="neutral"
              variant="ghost"
              block
              class="justify-start"
              @click="open = false"
            />
          </div>
        </template>
        <div class="lg:hidden">
          <USeparator class="mb-3" />
          <AppearanceChoice />
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
