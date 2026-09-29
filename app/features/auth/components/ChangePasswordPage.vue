<script setup lang="ts">
/**
 * Change password (D52). Forced while the account is on a temporary password (the route
 * middleware sends every page here); otherwise reached from the user menu. Changing it signs the
 * account out on its other devices.
 */
import type { FormErrorEvent, FormSubmitEvent } from '@nuxt/ui'
import { loginRedirectTarget, useAuth } from '../composables/useAuth'
import { emptyPasswordForm, passwordFormSchema } from '../schemas/password-form'
import type { PasswordForm } from '../schemas/password-form'

const route = useRoute()
const { user, mustChangePassword, changePassword, logout } = useAuth()
const toast = useToast()

// Decided when the page opens: after a successful change the flag clears, but the wording stays.
const forced = mustChangePassword.value

const state = reactive<PasswordForm>(emptyPasswordForm())
const saving = ref(false)
const error = ref<string>()
const showPasswords = ref(false)
const unsaved = useUnsavedChanges(state, { paused: saving })

// A failed step moves focus to what's wrong (page-patterns §5): the first invalid field, or the error.
const errorAlert = useTemplateRef<HTMLElement>('errorAlert')
// The form keeps its fields disabled until after this event (`loadingAuto`, re-enabled in its
// `finally`), and a disabled field can't take focus: focus on the next frame, once they're enabled.
function focusFirstInvalid(event: FormErrorEvent) {
  const id = event.errors[0]?.id
  if (id) requestAnimationFrame(() => document.getElementById(id)?.focus())
}

async function onSubmit({ data }: FormSubmitEvent<PasswordForm>) {
  saving.value = true
  error.value = undefined
  try {
    await changePassword(data.currentPassword, data.newPassword)
  }
  catch (e) {
    error.value = getErrorMessage(e)
    saving.value = false
    await nextTick()
    errorAlert.value?.focus()
    return
  }
  saving.value = false
  unsaved.markClean()
  toast.add({ title: 'Password changed', description: 'You were signed out on your other devices.', color: 'success', icon: 'i-lucide-circle-check' })
  await navigateTo(loginRedirectTarget(route.query.redirect))
}

const fields = [
  { name: 'currentPassword', label: forced ? 'Temporary password' : 'Current password', autocomplete: 'current-password' },
  { name: 'newPassword', label: 'New password', autocomplete: 'new-password', hint: 'At least 8 characters. Passwords found in known data breaches are refused.' },
  { name: 'confirmPassword', label: 'Repeat new password', autocomplete: 'new-password' },
] as const
</script>

<template>
  <TaskFrame>
    <template #header>
      <div class="space-y-1">
        <h1 class="text-lg font-semibold">
          {{ forced ? 'Choose your password' : 'Change password' }}
        </h1>
        <p class="text-sm text-muted">
          <template v-if="forced">
            {{ user?.email }} was given a temporary password. Choose your own to continue.
          </template>
          <template v-else>
            {{ user?.email }}
          </template>
        </p>
      </div>
    </template>

    <UForm
      id="password-form"
      :schema="passwordFormSchema"
      :state="state"
      :validate-on="['input', 'change']"
      :disabled="saving"
      class="space-y-4"
      @submit="onSubmit"
      @error="focusFirstInvalid"
    >
      <div
        v-if="error"
        ref="errorAlert"
        role="alert"
        tabindex="-1"
      >
        <UAlert
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="error"
        />
      </div>

      <UFormField
        v-for="field in fields"
        :key="field.name"
        :label="field.label"
        :name="field.name"
        :help="'hint' in field ? field.hint : undefined"
        required
      >
        <UInput
          v-model="state[field.name]"
          :type="showPasswords ? 'text' : 'password'"
          :autocomplete="field.autocomplete"
          class="w-full"
        />
      </UFormField>

      <USwitch
        v-model="showPasswords"
        label="Show passwords"
      />
    </UForm>

    <template #footer>
      <UButton
        type="submit"
        form="password-form"
        label="Change password"
        block
        :loading="saving"
      />
      <div class="flex justify-center">
        <UButton
          v-if="forced"
          label="Log out"
          color="neutral"
          variant="link"
          @click="logout()"
        />
        <UButton
          v-else
          label="Back"
          color="neutral"
          variant="link"
          :to="loginRedirectTarget(route.query.redirect)"
        />
      </div>
    </template>
  </TaskFrame>
</template>
