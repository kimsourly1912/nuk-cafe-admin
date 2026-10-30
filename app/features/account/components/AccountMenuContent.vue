<script setup lang="ts">
/**
 * The open account menu of a signed-in account (D97, D124): name, email, verification, member
 * code, Your orders, the staff workspaces, Appearance below `lg`, Sign out, and Delete account (D237).
 *
 * Rendered only while the menu is open (the popover's content), so the resend-email countdown and
 * its timer exist only then.
 */
import { useClipboard } from '@vueuse/core'
import type { CustomerAccount } from '#shared/contracts/account'
import { useAccountActions, useResendVerification } from '../composables/useCustomerAccount'
import AppearanceChoice from './AppearanceChoice.vue'

const props = defineProps<{ account: CustomerAccount }>()
const emit = defineEmits<{ close: [], delete: [] }>()

const tenantPath = useTenantPath()
const notify = useNotify()
const { signOut } = useAccountActions()
const { resend, sending, label: resendLabel, waiting } = useResendVerification()
const { copy, copied } = useClipboard({ copiedDuring: 2000, legacy: true })

// This cafe's workspaces (D124, D141), in this order, shown only when the server says this account
// may open them.
const WORKSPACE_LINKS = [
  { id: 'counter', label: 'Counter', icon: 'i-lucide-store', page: '/counter' },
  { id: 'admin', label: 'Admin workspace', icon: 'i-lucide-layout-dashboard', page: '/admin' },
] as const
const workspaces = computed(() => WORKSPACE_LINKS
  .filter(link => props.account.workspaces.includes(link.id))
  .map(link => ({ ...link, to: tenantPath(link.page) })))

async function signOutNow() {
  emit('close')
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
        Verify your email so you can always get back into your account.
      </p>
      <UButton
        :label="resendLabel"
        color="neutral"
        variant="outline"
        block
        :loading="sending"
        :disabled="waiting"
        @click="resend"
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
      :to="tenantPath('/orders')"
      color="neutral"
      variant="ghost"
      block
      class="justify-start"
      @click="emit('close')"
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
          @click="emit('close')"
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
    <UButton
      label="Delete account"
      icon="i-lucide-user-x"
      color="error"
      variant="ghost"
      block
      class="justify-start"
      @click="emit('close'); emit('delete')"
    />
  </div>
</template>
