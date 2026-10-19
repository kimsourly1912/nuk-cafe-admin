<script setup lang="ts">
/**
 * Add owner, or Transfer ownership from `from` (step P2, D189): an existing account found with the
 * owner search (D185) or a new account with a temporary password, and a reason for the platform
 * team. A transfer adds the new owner and removes `from` in one save. A new account's password is
 * shown once, then the dialog closes only with Done.
 */
import { useClipboard } from '@vueuse/core'
import type { FormSubmitEvent, RadioGroupItem } from '@nuxt/ui'
import type * as v from 'valibot'
import type { PlatformOwner, TenantDetail, TenantOwner } from '#shared/contracts/tenants'
import { OWNERSHIP_REASON_MAX } from '#shared/contracts/tenants'
import { useCafeMutations } from '../composables/useCafes'
import { ownedCafesLine } from '../schemas/cafe-form'
import type { OwnerForm } from '../schemas/owner-form'
import { emptyOwnerForm, ownerFormSchema, removalLine } from '../schemas/owner-form'
import OwnerAccountPicker from './OwnerAccountPicker.vue'

const props = defineProps<{ cafe: TenantDetail, from?: TenantOwner }>()
const emit = defineEmits<{ 'close': [saved: boolean], 'update:open': [open: boolean] }>()

const OWNER_CHOICES: RadioGroupItem[] = [
  { label: 'Use existing account', description: 'Keep their current password.', value: 'existing' },
  { label: 'Create new account', description: 'Generate a temporary password.', value: 'new' },
]

const initial = emptyOwnerForm()
const state = reactive<OwnerForm>(structuredClone(initial))
const account = ref<PlatformOwner>()
// Sync: the picker validates in the same tick as the pick (as on Create a cafe, D185).
watch(account, (chosen) => {
  state.owner.userId = chosen?.id ?? ''
}, { flush: 'sync' })

const form = useTemplateRef('form')
useFormErrorRecheck(form)
const { addOwner, transferOwner } = useCafeMutations()
const saving = ref(false)
const password = ref<string | null>(null)
const clipboard = useClipboard({ source: () => password.value ?? '', copiedDuring: 2000 })
const unsaved = useModalUnsavedChanges(state, { initial, paused: saving, close: () => emit('close', false) })

// "Create new account" found an account with the email: offer it as an existing one (D185).
const emailHasAccount = ref<string>()
watch(() => state.owner.email, () => {
  emailHasAccount.value = undefined
})
const seed = ref<{ email: string }>()
function chooseExistingAccount() {
  if (emailHasAccount.value) seed.value = { email: emailHasAccount.value }
  state.owner.kind = 'existing'
  emailHasAccount.value = undefined
}

const title = computed(() => props.from ? `Transfer ${props.from.name}'s ownership` : `Add an owner to ${props.cafe.name}`)
const description = computed(() => props.from
  ? `The new owner is added and ${props.from.name} removed in one step. ${removalLine(props.from)} They're signed out everywhere.`
  : 'They manage the cafe\'s menu, staff and payments in its admin. The other owners stay.')
const submitLabel = computed(() => props.from ? 'Transfer ownership' : 'Add owner')
/** The new account the password is for, as saved. */
const newOwner = ref({ name: '', email: '' })

async function onSubmit({ data }: FormSubmitEvent<v.InferOutput<typeof ownerFormSchema>>) {
  if (saving.value) return
  saving.value = true
  const body = { version: props.cafe.version, ...data }
  const result = props.from
    ? await transferOwner.execute({ cafe: props.cafe, owner: props.from, body })
    : await addOwner.execute({ cafe: props.cafe, body })
  saving.value = false
  if (!result.ok) {
    if (result.status === 'error') {
      if (result.error.code === 'ACCOUNT_EXISTS' && data.owner.kind === 'new') emailHasAccount.value = data.owner.email
      form.value?.setErrors(Object.entries(result.error.fieldErrors ?? {})
        .flatMap(([name, messages]) => (messages[0] ? [{ name, message: messages[0] }] : [])))
    }
    return
  }
  unsaved.markClean()
  if (result.data.temporaryPassword) {
    if (data.owner.kind === 'new') newOwner.value = { name: data.owner.name, email: data.owner.email }
    password.value = result.data.temporaryPassword
    return
  }
  emit('close', true)
}
</script>

<template>
  <UModal
    :title="password ? 'Temporary password' : title"
    :description="password ? undefined : description"
    :dismissible="!password && !saving"
    :close="!password"
    @update:open="unsaved.onOpenChange"
  >
    <template #body>
      <div
        v-if="password"
        class="space-y-4 text-sm"
      >
        <p>
          Give this password to <span class="font-medium">{{ newOwner.name }}</span> ({{ newOwner.email }}).
          They choose their own at their first sign-in.
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
        id="owner-form"
        ref="form"
        :schema="ownerFormSchema"
        :state="state"
        :disabled="saving"
        class="space-y-4"
        @submit="onSubmit"
        @error="focusFirstInvalid"
      >
        <URadioGroup
          v-model="state.owner.kind"
          :items="OWNER_CHOICES"
          variant="card"
          orientation="horizontal"
          legend="Owner account"
          :ui="{ legend: 'sr-only', fieldset: 'max-sm:flex-col', item: 'flex-1' }"
        />

        <template v-if="state.owner.kind === 'existing'">
          <UFormField
            label="Account"
            name="owner.userId"
            help="Search registered customers, staff and owners by name or email."
            required
          >
            <OwnerAccountPicker
              v-model:account="account"
              :seed="seed"
              aria-label="Account"
              class="w-full"
            />
          </UFormField>
          <div
            v-if="account"
            class="space-y-1 rounded-md bg-elevated/50 p-3 text-sm"
            data-testid="chosen-owner"
          >
            <p class="font-medium text-highlighted">
              {{ account.name }}
            </p>
            <p class="break-all text-muted">
              {{ account.email }}
            </p>
            <p>{{ ownedCafesLine(account) }}</p>
          </div>
        </template>

        <template v-else>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField
              label="Owner name"
              name="owner.name"
              required
            >
              <UInput
                v-model="state.owner.name"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Email"
              name="owner.email"
              required
            >
              <UInput
                v-model="state.owner.email"
                type="email"
                class="w-full"
              />
            </UFormField>
          </div>
          <UAlert
            v-if="emailHasAccount"
            role="alert"
            color="warning"
            variant="subtle"
            icon="i-lucide-user-check"
            title="This email already has an account"
            description="Make them the owner with their current password instead."
            :actions="[{ label: 'Use existing account', color: 'neutral', variant: 'outline', onClick: chooseExistingAccount }]"
          />
        </template>

        <UFormField
          label="Reason"
          name="reason"
          help="For the platform team, e.g. the owner's request or how you checked it's them. It isn't shown to the cafe."
          required
        >
          <UTextarea
            v-model="state.reason"
            :maxlength="OWNERSHIP_REASON_MAX"
            :rows="3"
            autoresize
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
          @click="emit('close', true)"
        />
        <template v-else>
          <UButton
            label="Cancel"
            color="neutral"
            variant="outline"
            :disabled="saving"
            @click="unsaved.requestClose()"
          />
          <UButton
            type="submit"
            form="owner-form"
            :label="submitLabel"
            :loading="saving"
          />
        </template>
      </div>
    </template>
  </UModal>
</template>
