<script setup lang="ts">
/**
 * A temporary password for an account (step P1, D187): for an owner or customer who lost access
 * while email can't be sent (Q4). First why, for the platform team; then the password, shown once
 * (it isn't stored anywhere it can be read again). Their old password stops working and every
 * device they use is signed out; they choose their own password at the next sign-in.
 */
import { useClipboard } from '@vueuse/core'
import type { FormSubmitEvent } from '@nuxt/ui'
import * as v from 'valibot'
import type { PlatformAccountDetail } from '#shared/contracts/accounts'
import { ACCOUNT_REASON_MAX, accountPasswordSchema } from '#shared/contracts/accounts'
import { useAccountMutations } from '../composables/useAccounts'

const props = defineProps<{ account: PlatformAccountDetail }>()
const emit = defineEmits<{ close: [] }>()

const schema = v.pick(accountPasswordSchema, ['reason'])
const state = reactive({ reason: '' })
const form = useTemplateRef('form')
useFormErrorRecheck(form)
const { temporaryPassword } = useAccountMutations()
const saving = ref(false)
const password = ref<string | null>(null)
const clipboard = useClipboard({ source: () => password.value ?? '', copiedDuring: 2000 })

async function onSubmit({ data }: FormSubmitEvent<v.InferOutput<typeof schema>>) {
  saving.value = true
  const result = await temporaryPassword.execute({ account: props.account, body: { version: props.account.version, reason: data.reason } })
  saving.value = false
  if (result.ok) password.value = result.data.temporaryPassword
}
</script>

<template>
  <AppModal
    :title="password ? 'Temporary password' : `Set a temporary password for ${account.name}?`"
    :description="password ? undefined : 'Their current password stops working and every device they use is signed out. They choose a new password at their next sign-in.'"
    :dismissible="!password && !saving"
    :close="!password"
  >
    <template #body>
      <div
        v-if="password"
        class="space-y-4 text-sm"
      >
        <p>
          Give this password to <span class="font-medium">{{ account.name }}</span> ({{ account.email }}).
          They choose their own at their next sign-in.
        </p>
        <div class="flex items-center gap-2">
          <code
            class="flex-1 rounded-md bg-elevated px-3 py-2 text-center font-mono text-lg tracking-wider"
            data-testid="temporary-password"
          >{{ password }}</code>
          <UButton
            v-if="clipboard.isSupported.value"
            :icon="clipboard.copied.value ? 'i-lucide-check' : 'i-lucide-copy'"
            :label="clipboard.copied.value ? 'Copied' : 'Copy'"
            color="neutral"
            variant="outline"
            @click="clipboard.copy()"
          />
        </div>
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="It won't be shown again"
          description="Hand it over in person or through a private channel, once you're sure it's them."
        />
      </div>
      <UForm
        v-else
        id="password-form"
        ref="form"
        :schema="schema"
        :state="state"
        :disabled="saving"
        @submit="onSubmit"
        @error="focusFirstInvalid"
      >
        <UFormField
          label="Reason"
          name="reason"
          help="For the platform team, e.g. how you checked it's really them."
          required
        >
          <UTextarea
            v-model="state.reason"
            :maxlength="ACCOUNT_REASON_MAX"
            :rows="3"
            autoresize
            autofocus
            class="w-full"
          />
        </UFormField>
      </UForm>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          v-if="password"
          label="Done"
          @click="emit('close')"
        />
        <template v-else>
          <UButton
            label="Cancel"
            color="neutral"
            variant="outline"
            :disabled="saving"
            @click="emit('close')"
          />
          <UButton
            type="submit"
            form="password-form"
            label="Set temporary password"
            :loading="saving"
          />
        </template>
      </div>
    </template>
  </AppModal>
</template>
