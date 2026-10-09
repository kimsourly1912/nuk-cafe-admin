<script setup lang="ts">
/**
 * New cafe (the platform console, D142): the cafe and its web address, its first branch and its
 * first owner, saved together. The address follows the name until it's edited by hand. The owner
 * is **an existing owner** (chosen from everyone who owns a cafe: they keep their account) or **a
 * new person** (D146); a cafe's page opens it with its owner already chosen. The server refuses an
 * address any cafe has or had, an unknown time zone, and a new person's email that is an owner's,
 * on their fields. Afterwards the result shows the owner's cafes and a new person's temporary
 * password once (`CafeCreatedModal`). Like the other forms, it stays open while saving but can be
 * closed: the save continues, and a failure offers "Reopen".
 */
import type { FormSubmitEvent, RadioGroupItem } from '@nuxt/ui'
import type { CreateTenantInput, TenantOwner } from '#shared/contracts/tenants'
import { slugFromName } from '#shared/contracts/tenants'
import { useCafeMutations, useCafeOwners } from '../composables/useCafes'
import { cafeFormSchema, emptyCafeForm, ownedCafesLine, ownerLabel } from '../schemas/cafe-form'
import type { CafeForm } from '../schemas/cafe-form'
import CafeCreatedModal from './CafeCreatedModal.vue'
import CafeFormModal from './CafeFormModal.vue'

const props = defineProps<{
  /** Restores unsaved input (used by "Reopen" after a failed background save). */
  draft?: CafeForm
  /** New cafe for this owner (a cafe's page): chosen already. */
  owner?: TenantOwner
}>()
const emit = defineEmits<{ 'close': [saved: boolean], 'update:open': [open: boolean] }>()

const { isCompact } = useLayoutContext()
const initial = emptyCafeForm({ owner: props.owner })
const state = reactive<CafeForm>(structuredClone(toRaw(props.draft) ?? initial))

// The address follows the name until someone types their own.
const slugEdited = ref(Boolean(props.draft?.slug && props.draft.slug !== slugFromName(props.draft.name)))
watch(() => state.name, (name) => {
  if (!slugEdited.value) state.slug = slugFromName(name)
})

const zones = timezoneOptions(state.timezone)

// --- The first owner (D146) ---

const OWNER_CHOICES: RadioGroupItem[] = [
  { label: 'A new person', description: 'They get an account with a temporary password.', value: 'new' },
  { label: 'An existing owner', description: 'Someone who owns a cafe: they use their own account.', value: 'existing' },
]
const owners = useCafeOwners()
const ownerItems = computed(() => {
  const items = (owners.data.value ?? []).map(owner => ({ label: ownerLabel(owner), value: owner.id }))
  // The owner a cafe's page chose, until the list arrives.
  if (props.owner && !items.some(item => item.value === props.owner!.id)) items.unshift({ label: ownerLabel(props.owner), value: props.owner.id })
  return items
})
const chosenOwner = computed(() => owners.data.value?.find(owner => owner.id === state.owner.userId))
const origin = import.meta.client ? window.location.origin : ''

const { create } = useCafeMutations()
const saving = ref(false)

const unsaved = useModalUnsavedChanges(state, {
  initial,
  paused: saving,
  close: () => emit('close', false),
})

const form = useTemplateRef('form')
useSubmitShortcut(() => form.value?.submit())

let closed = false
onUnmounted(() => {
  closed = true
})
const overlay = useOverlay()
const createdModal = overlay.create(CafeCreatedModal)
function reopenActions(draft: CafeForm) {
  if (!closed) return []
  return [{ label: 'Reopen', onClick: () => overlay.create(CafeFormModal, { destroyOnClose: true }).open({ draft, owner: props.owner }) }]
}

// The schema's output: trimmed, lowercased, and only the chosen owner's fields.
async function onSubmit({ data }: FormSubmitEvent<CreateTenantInput>) {
  const draft = structuredClone(toRaw(state))
  saving.value = true
  const result = await create.execute(data, { errorActions: () => reopenActions(draft) })
  saving.value = false
  if (!result.ok) {
    if (result.status === 'error') {
      form.value?.setErrors(Object.entries(result.error.fieldErrors ?? {})
        .flatMap(([name, messages]) => (messages[0] ? [{ name, message: messages[0] }] : [])))
    }
    return
  }
  unsaved.markClean()
  emit('close', true)
  // Shown even if this form was closed while saving: it's the only time the password can be read.
  void createdModal.open({ created: result.data })
}
</script>

<template>
  <UModal
    title="New cafe"
    description="The cafe, its first branch and its first owner. The owner sets up the menu, staff and payments."
    :fullscreen="isCompact"
    :ui="{ footer: 'pb-[max(env(safe-area-inset-bottom),1rem)]' }"
    @update:open="unsaved.onOpenChange"
  >
    <template #body>
      <UForm
        id="cafe-form"
        ref="form"
        :schema="cafeFormSchema"
        :state="state"
        :validate-on="['input', 'change']"
        :disabled="saving"
        class="space-y-6"
        @submit="onSubmit"
      >
        <section
          aria-labelledby="cafe-form-cafe"
          class="space-y-4"
        >
          <h3
            id="cafe-form-cafe"
            class="text-sm font-semibold text-highlighted"
          >
            Cafe
          </h3>
          <UFormField
            label="Name"
            name="name"
            required
          >
            <UInput
              v-model="state.name"
              class="w-full"
              autofocus
            />
          </UFormField>
          <UFormField
            label="Web address"
            name="slug"
            :help="`${origin}/c/${state.slug || '…'}: lowercase letters, numbers and dashes. It can be changed later; the old one keeps working.`"
            required
          >
            <UInput
              v-model="state.slug"
              class="w-full"
              autocapitalize="none"
              spellcheck="false"
              @input="slugEdited = true"
            >
              <template #leading>
                <span class="text-sm text-muted">/c/</span>
              </template>
            </UInput>
          </UFormField>
        </section>

        <section
          aria-labelledby="cafe-form-branch"
          class="space-y-4"
        >
          <h3
            id="cafe-form-branch"
            class="text-sm font-semibold text-highlighted"
          >
            First branch
          </h3>
          <UFormField
            label="Branch name"
            name="branchName"
            required
          >
            <UInput
              v-model="state.branchName"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Time zone"
            name="timezone"
            help="Opening hours and the business day follow this clock."
            required
          >
            <USelectMenu
              v-model="state.timezone"
              :items="zones"
              value-key="value"
              :search-input="{ placeholder: 'Search time zones…' }"
              virtualize
              aria-label="Time zone"
              class="w-full"
            />
          </UFormField>
        </section>

        <section
          aria-labelledby="cafe-form-owner"
          class="space-y-4"
        >
          <h3
            id="cafe-form-owner"
            class="text-sm font-semibold text-highlighted"
          >
            First owner
          </h3>
          <URadioGroup
            v-model="state.owner.kind"
            :items="OWNER_CHOICES"
            variant="card"
            orientation="horizontal"
            legend="Who owns it"
            :ui="{ legend: 'sr-only', fieldset: 'max-sm:flex-col', item: 'flex-1' }"
          />
          <template v-if="state.owner.kind === 'existing'">
            <ApiErrorAlert
              v-if="owners.error.value"
              :error="owners.error.value"
              title="Could not load the owners"
              @retry="owners.refresh()"
            />
            <UFormField
              v-else
              label="Owner"
              name="owner.userId"
              :help="chosenOwner ? ownedCafesLine(chosenOwner) : 'Everyone who owns a cafe, by name. Search by name or email.'"
              required
            >
              <RecordSelect
                v-model="state.owner.userId"
                :items="ownerItems"
                noun="owners"
                :loading="owners.loading.value"
                placeholder="Choose an owner"
                aria-label="Owner"
                class="w-full"
              />
            </UFormField>
          </template>
          <template v-else>
            <UFormField
              label="Name"
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
              help="They get a temporary password, shown once. If this email already has an account (a customer), it gets access and keeps its password."
              required
            >
              <UInput
                v-model="state.owner.email"
                type="email"
                class="w-full"
              />
            </UFormField>
          </template>
        </section>
      </UForm>
    </template>

    <template #footer>
      <div class="flex w-full flex-wrap items-center justify-end gap-2">
        <span
          v-if="saving"
          class="mr-auto min-w-0 text-xs text-muted"
        >
          You can close this; saving continues in the background.
        </span>
        <UButton
          :label="saving ? 'Close' : 'Cancel'"
          color="neutral"
          variant="outline"
          @click="unsaved.requestClose()"
        />
        <UTooltip
          text="Create cafe"
          :kbds="['meta', 'enter']"
        >
          <UButton
            type="submit"
            form="cafe-form"
            label="Create cafe"
            :loading="saving"
          />
        </UTooltip>
      </div>
    </template>
  </UModal>
</template>
