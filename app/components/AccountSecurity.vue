<script setup lang="ts">
/**
 * The account security page's body (D242), for a cafe's admin and its counter: two-step sign-in,
 * on or off. **Turn on** opens the shared setup (`<TwoFactorSetupFrame>`, the console's steps);
 * **Turn off** asks for the password (`<TwoFactorTurnOffModal>`). Optional for owners and staff
 * (Q1). `changed` tells the surface's session; this page then shows the new state.
 *
 * @example
 * <AccountSecurity :enabled="user.twoFactorEnabled" :email="user.email" :back-to="home" back-label="Back to the counter" :changed="twoFactorChanged" />
 */
import { TwoFactorTurnOffModal } from '#components'

const props = defineProps<{
  enabled: boolean
  email?: string
  /** Where the page's way back goes: the admin's dashboard or the counter. */
  backTo: string
  backLabel: string
  changed: (enabled: boolean) => void
}>()

const settingUp = ref(false)
const turnOffModal = useOverlay().create(TwoFactorTurnOffModal)

function finishSetup() {
  props.changed(true)
  settingUp.value = false
  // Staff shows each person's status.
  void invalidate('staff')
}

async function turnOff() {
  if (await turnOffModal.open().result) props.changed(false)
}
</script>

<template>
  <TwoFactorSetupFrame
    v-if="settingUp"
    intro="Ask for a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) as well as your password, so a stolen password alone can't open your account."
    :email="email"
    :done="finishSetup"
  >
    <template #secondary="{ saving }">
      <UButton
        label="Cancel"
        color="neutral"
        variant="ghost"
        block
        :disabled="saving"
        @click="settingUp = false"
      />
    </template>
  </TwoFactorSetupFrame>

  <TaskFrame v-else>
    <template #header>
      <div class="flex items-center gap-3">
        <UIcon
          name="i-lucide-shield-check"
          class="size-6 shrink-0 text-primary"
        />
        <h1 class="text-lg font-semibold">
          Account security
        </h1>
      </div>
    </template>

    <section
      class="space-y-2"
      aria-labelledby="two-factor-heading"
    >
      <div class="flex items-center justify-between gap-3">
        <h2
          id="two-factor-heading"
          class="font-medium text-highlighted"
        >
          Two-step sign-in
        </h2>
        <UBadge
          :label="enabled ? 'On' : 'Off'"
          :color="enabled ? 'success' : 'neutral'"
          variant="subtle"
          data-testid="two-factor-status"
        />
      </div>
      <p class="text-sm text-muted">
        <template v-if="enabled">
          You enter a code from your authenticator app each time you sign in. Lost your phone? Use one of your backup codes.
        </template>
        <template v-else>
          Ask for a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) as well as your password, so a stolen password alone can't open your account.
        </template>
      </p>
    </section>

    <template #footer>
      <UButton
        v-if="enabled"
        label="Turn off"
        color="neutral"
        variant="outline"
        block
        @click="turnOff()"
      />
      <UButton
        v-else
        label="Turn on"
        block
        @click="settingUp = true"
      />
      <UButton
        :label="backLabel"
        :to="backTo"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        block
      />
    </template>
  </TaskFrame>
</template>
