<script setup lang="ts">
/**
 * The admin's support strip (P5, D193), above every page. For a super admin on a support visit: they
 * are looking at this cafe as platform support, read-only, until when, with Leave (back to the
 * console). For the cafe's owners while support is allowed: until when, with a link to end it.
 */
import { useAuth } from '~/features/auth'

const { user } = useAuth()
const tenantPath = useTenantPath()
const leaving = ref(false)

const time = (at: string) => new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/** Closes the visit, then a full page load to the cafe's page in the console (another workspace). */
async function leave() {
  const support = user.value?.support
  if (!support || leaving.value) return
  leaving.value = true
  await $fetch(`/api/platform/tenants/${support.tenantId}/support/close`, { method: 'POST' }).catch(() => {})
  window.location.assign(`/platform/cafes/${support.tenantId}`)
}
</script>

<template>
  <div
    v-if="user?.support"
    role="status"
    class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-warning px-4 py-2 text-sm font-medium text-inverted print:hidden"
    data-testid="support-banner"
  >
    <span>Platform support view: read-only until {{ time(user.support.visitExpiresAt) }}. Nothing can be changed.</span>
    <UButton
      label="Leave"
      size="xs"
      color="neutral"
      variant="solid"
      :loading="leaving"
      @click="leave()"
    />
  </div>
  <div
    v-else-if="user?.supportAllowedUntil"
    role="status"
    class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-info/10 px-4 py-2 text-sm text-highlighted print:hidden"
    data-testid="support-allowed-banner"
  >
    <span>Platform support can look at this cafe until {{ time(user.supportAllowedUntil) }}.</span>
    <ULink
      :to="tenantPath('/admin/support')"
      class="font-medium underline"
    >
      Manage
    </ULink>
  </div>
</template>
