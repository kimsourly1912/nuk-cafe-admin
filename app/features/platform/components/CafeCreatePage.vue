<script setup lang="ts">
/**
 * Create a cafe (`/platform/cafes/new`, D142, D185): the cafe and its web address, its first branch
 * and its first owner, on one page, saved together with one "Create cafe" (no review step). The
 * address follows the name until it's edited by hand, and says whether it's free (advisory: the save
 * decides). The owner is **a new account** (a temporary password, shown once afterwards) or **an
 * existing account** found by name or email (it keeps its password, profile and other cafes). A
 * cafe's page opens it with an account chosen already (`?owner=<id>`: an id, never a secret). The
 * server refuses an address any cafe has or had, an unknown time zone, a new account's email that
 * has an account already (it is chosen as an existing one) and an account that can't own a cafe,
 * on their fields.
 *
 * Saving continues if the page is left: the result (`CafeCreatedModal`, the only place the password
 * can be read) opens over whatever page is showing, and a failure offers "Reopen".
 */
import type { FormSubmitEvent, RadioGroupItem } from '@nuxt/ui'
import type { CreateTenantInput, PlatformOwner } from '#shared/contracts/tenants'
import { slugFromName } from '#shared/contracts/tenants'
import { PLATFORM_HOME } from '../composables/usePlatformSession'
import { reopenCafeForm, takeReopenedCafeForm, useCafeMutations, useOwnerAccount, useSlugAvailability } from '../composables/useCafes'
import { afterCreationSteps, cafeFormSchema, emptyCafeForm, ownedCafesLine } from '../schemas/cafe-form'
import type { CafeForm } from '../schemas/cafe-form'
import CafeCreatedModal from './CafeCreatedModal.vue'
import OwnerAccountPicker from './OwnerAccountPicker.vue'

const props = defineProps<{
  /** New cafe for this owner (a cafe's page): the validated id of the account, chosen already. */
  ownerId?: string
}>()

const { isCompact } = useLayoutContext()
const draft = takeReopenedCafeForm()
// The account to fetch: a failed save's own choice, else the page's.
const presetId = draft?.owner.kind === 'existing' ? draft.owner.userId : props.ownerId
const initial = emptyCafeForm({ ownerId: props.ownerId })
const state = reactive<CafeForm>(structuredClone(draft ?? initial))

// The address follows the name until someone types their own.
const slugEdited = ref(Boolean(draft?.slug && draft.slug !== slugFromName(draft.name)))
watch(() => state.name, (name) => {
  if (!slugEdited.value) state.slug = slugFromName(name)
})
const address = useSlugAvailability(() => state.slug)
const origin = import.meta.client ? window.location.origin : ''

const zones = timezoneOptions(state.timezone)
const zoneLabel = computed(() => zones.find(zone => zone.value === state.timezone)?.label)

// --- The first owner (D185) ---

const OWNER_CHOICES: RadioGroupItem[] = [
  { label: 'Create new account', description: 'Generate a temporary password.', value: 'new' },
  { label: 'Use existing account', description: 'Keep their current password.', value: 'existing' },
]
const account = ref<PlatformOwner>()
watch(account, (chosen) => {
  state.owner.userId = chosen?.id ?? ''
})

// An account chosen before the page (a cafe's page, a failed save's draft): read from the server.
const preset = useOwnerAccount(presetId)
const presetFailed = computed(() => Boolean(presetId && preset.error.value))
watch(() => preset.data.value, (found) => {
  if (found && !account.value) account.value = found
}, { immediate: true })

const saving = ref(false)
const unsaved = useUnsavedChanges(state, { initial, paused: saving })
// The account can't be chosen (unknown, disabled, a guest): the page opens as a new account, clean.
watch(presetFailed, (failed) => {
  if (!failed) return
  state.owner.kind = 'new'
  state.owner.userId = ''
  const base = structuredClone(initial)
  base.owner = { ...base.owner, kind: 'new', userId: '' }
  unsaved.markClean(base)
})

// "Create new account" found an account with the email: say so, and offer it as an existing one.
const emailHasAccount = ref<string>()
watch(() => state.owner.email, () => {
  emailHasAccount.value = undefined
})
/** Each choice is a new object, so choosing the same email again searches again. */
const seed = ref<{ email: string }>()
function chooseExistingAccount() {
  if (emailHasAccount.value) seed.value = { email: emailHasAccount.value }
  state.owner.kind = 'existing'
  emailHasAccount.value = undefined
}

const { create } = useCafeMutations()

const form = useTemplateRef('form')
useFormErrorRecheck(form)
useSubmitShortcut(() => form.value?.submit())

// --- Leaving ---

const router = useRouter()
/** Back to where the page was opened from (the list with its search and filters, or a cafe's page), else the list. */
function leave() {
  const back = window.history.state?.back
  if (typeof back === 'string' && (back === PLATFORM_HOME || back.startsWith(`${PLATFORM_HOME}?`) || back.startsWith('/platform/cafes/'))) router.back()
  else void navigateTo(PLATFORM_HOME)
}
/** After saving: to the list, with its filters when the page came from it. */
function leaveSaved() {
  const back = window.history.state?.back
  if (typeof back === 'string' && (back === PLATFORM_HOME || back.startsWith(`${PLATFORM_HOME}?`))) router.back()
  else void navigateTo(PLATFORM_HOME)
}

let closed = false
onUnmounted(() => {
  closed = true
})
const createdModal = useOverlay().create(CafeCreatedModal)
function reopenActions(failed: CafeForm) {
  if (!closed) return []
  return [{ label: 'Reopen', onClick: () => void reopenCafeForm(failed) }]
}

// The schema's output: trimmed, lowercased, and only the chosen owner's fields.
async function onSubmit({ data }: FormSubmitEvent<CreateTenantInput>) {
  // A second submit (Ctrl/⌘+Enter while saving) is not another save.
  if (saving.value) return
  if (address.value === 'taken') {
    form.value?.setErrors([{ name: 'slug', message: 'Already used by a cafe, now or before' }])
    return
  }
  const failed = structuredClone(toRaw(state))
  saving.value = true
  const result = await create.execute(data, { errorActions: () => reopenActions(failed) })
  saving.value = false
  if (!result.ok) {
    if (result.status === 'error') {
      if (result.error.code === 'ACCOUNT_EXISTS' && data.owner.kind === 'new') emailHasAccount.value = data.owner.email
      form.value?.setErrors(Object.entries(result.error.fieldErrors ?? {})
        .flatMap(([name, messages]) => (messages[0] ? [{ name, message: messages[0] }] : [])))
    }
    return
  }
  // Shown even if the page was left while saving: it's the only time the password can be read.
  void createdModal.open({ created: result.data })
  if (closed) return
  unsaved.markClean()
  leaveSaved()
}

// --- The summary ---

const ownerName = computed(() => state.owner.kind === 'new' ? state.owner.name.trim() : account.value?.name ?? '')
const steps = computed(() => afterCreationSteps(state.owner.kind))
const unset = 'Not set yet'
</script>

<template>
  <UDashboardPanel
    id="cafe-new"
    class="page-narrow"
    :ui="{ body: 'bg-elevated/50' }"
  >
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            aria-label="Back"
            class="lg:hidden"
            @click="leave()"
          />
        </template>
        <template #title>
          <UBreadcrumb
            :items="[{ label: 'Cafes', to: PLATFORM_HOME }, { label: 'New cafe' }]"
            class="hidden min-w-0 lg:flex"
          />
          <span class="truncate lg:hidden">New cafe</span>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="space-y-6">
        <div>
          <h2 class="text-xl font-semibold text-highlighted">
            Create a cafe
          </h2>
          <p class="text-sm text-muted">
            Create the cafe, its first branch and owner in one go.
          </p>
        </div>

        <UForm
          id="cafe-form"
          ref="form"
          :schema="cafeFormSchema"
          :state="state"
          :validate-on="['blur', 'change']"
          :disabled="saving"
          class="@container"
          @submit="onSubmit"
          @error="focusFirstInvalid"
        >
          <div class="grid gap-6 @3xl:grid-cols-3">
            <div class="space-y-6 @3xl:col-span-2">
              <UCard
                as="section"
                aria-labelledby="cafe-new-cafe"
                variant="outline"
                class="@container"
              >
                <template #header>
                  <h3
                    id="cafe-new-cafe"
                    class="font-semibold text-highlighted"
                  >
                    Cafe details
                  </h3>
                </template>
                <div class="grid gap-4 @md:grid-cols-2">
                  <UFormField
                    label="Name"
                    name="name"
                    required
                  >
                    <!-- Not on a phone: the keyboard would open over the page and hide the actions. -->
                    <UInput
                      v-model="state.name"
                      class="w-full"
                      :autofocus="!isCompact"
                    />
                  </UFormField>
                  <UFormField
                    label="Web address"
                    name="slug"
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
                    <!-- Beside the field's own help or error, so an error on the field never hides the check. -->
                    <div class="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm text-muted">
                      <span class="min-w-0 break-all">{{ origin }}/c/{{ state.slug || '…' }}</span>
                      <span
                        role="status"
                        aria-live="polite"
                        class="flex items-center gap-1"
                      >
                        <template v-if="address === 'available'">
                          <UIcon
                            name="i-lucide-circle-check"
                            class="size-4 text-success"
                          />
                          <span class="text-success">Address available</span>
                        </template>
                        <template v-else-if="address === 'taken'">
                          <UIcon
                            name="i-lucide-circle-x"
                            class="size-4 text-error"
                          />
                          <span class="text-error">Address taken</span>
                        </template>
                        <template v-else-if="address === 'checking'">
                          <UIcon
                            name="i-lucide-loader-circle"
                            class="size-4 motion-safe:animate-spin"
                          />
                          <span>Checking address…</span>
                        </template>
                        <span v-else-if="address === 'unknown'">Could not check the address</span>
                      </span>
                    </div>
                  </UFormField>
                </div>
                <p class="mt-4 text-sm text-muted">
                  Lowercase letters, numbers and dashes. It can be changed later; the old one keeps working.
                </p>
              </UCard>

              <UCard
                as="section"
                aria-labelledby="cafe-new-branch"
                variant="outline"
                class="@container"
              >
                <template #header>
                  <h3
                    id="cafe-new-branch"
                    class="font-semibold text-highlighted"
                  >
                    First branch
                  </h3>
                </template>
                <div class="grid gap-4 @md:grid-cols-2">
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
                    help="Opening hours follow this time zone."
                    required
                  >
                    <USelectMenu
                      v-model="state.timezone"
                      :items="zones"
                      value-key="value"
                      :search-input="{ placeholder: 'Search time zones…' }"
                      virtualize
                      role="combobox"
                      aria-label="Time zone"
                      class="w-full"
                    />
                  </UFormField>
                </div>
              </UCard>

              <UCard
                as="section"
                aria-labelledby="cafe-new-owner"
                variant="outline"
                class="@container"
              >
                <template #header>
                  <h3
                    id="cafe-new-owner"
                    class="font-semibold text-highlighted"
                  >
                    First owner
                  </h3>
                </template>
                <div class="space-y-4">
                  <URadioGroup
                    v-model="state.owner.kind"
                    :items="OWNER_CHOICES"
                    variant="card"
                    orientation="horizontal"
                    legend="Owner account"
                    :ui="{ legend: 'sr-only', fieldset: 'max-sm:flex-col', item: 'flex-1' }"
                  />

                  <template v-if="state.owner.kind === 'existing'">
                    <UAlert
                      v-if="presetFailed"
                      color="warning"
                      variant="subtle"
                      icon="i-lucide-triangle-alert"
                      title="That account can't be chosen"
                      description="It may have been disabled or isn't a registered account. Search for another."
                    />
                    <ApiErrorAlert
                      v-else-if="preset.error.value"
                      :error="preset.error.value"
                      title="Could not load the account"
                      @retry="preset.refresh()"
                    />
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
                      <p class="text-muted">
                        Their password, profile and access to other cafes stay unchanged.
                      </p>
                    </div>
                    <p
                      v-else-if="preset.loading.value"
                      class="text-sm text-muted"
                    >
                      Loading the account…
                    </p>
                  </template>

                  <template v-else>
                    <div class="grid gap-4 @md:grid-cols-2">
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
                      description="Make them the owner with their current password instead. The cafe details you entered stay."
                      :actions="[{ label: 'Use existing account', color: 'neutral', variant: 'outline', onClick: chooseExistingAccount }]"
                    />
                    <div class="flex items-start gap-3 rounded-md bg-elevated/50 p-3 text-sm">
                      <UIcon
                        name="i-lucide-key-round"
                        class="mt-0.5 size-5 shrink-0 text-muted"
                      />
                      <div>
                        <p class="font-medium text-highlighted">
                          Password shown after creation
                        </p>
                        <p class="text-muted">
                          Share it with the owner. They must change it at first sign-in.
                        </p>
                      </div>
                    </div>
                  </template>
                </div>
              </UCard>
            </div>

            <aside
              aria-labelledby="cafe-new-summary"
              class="space-y-6 self-start"
            >
              <UCard variant="outline">
                <template #header>
                  <h3
                    id="cafe-new-summary"
                    class="font-semibold text-highlighted"
                  >
                    Creation summary
                  </h3>
                </template>
                <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt class="text-muted">
                    Cafe
                  </dt>
                  <dd :class="['min-w-0 wrap-break-word', state.name.trim() ? 'font-medium text-highlighted' : 'text-muted']">
                    {{ state.name.trim() || unset }}
                  </dd>
                  <dt class="text-muted">
                    Address
                  </dt>
                  <dd :class="['min-w-0 break-all', state.slug ? 'font-medium text-highlighted' : 'text-muted']">
                    {{ state.slug ? `/c/${state.slug}` : unset }}
                  </dd>
                  <dt class="text-muted">
                    Branch
                  </dt>
                  <dd :class="['min-w-0 wrap-break-word', state.branchName.trim() ? 'font-medium text-highlighted' : 'text-muted']">
                    {{ state.branchName.trim() || unset }}
                    <span
                      v-if="zoneLabel"
                      class="block font-normal text-muted"
                    >{{ zoneLabel }}</span>
                  </dd>
                  <dt class="text-muted">
                    Owner
                  </dt>
                  <dd :class="['min-w-0 wrap-break-word', ownerName ? 'font-medium text-highlighted' : 'text-muted']">
                    {{ ownerName || unset }}
                  </dd>
                  <dt class="text-muted">
                    Account
                  </dt>
                  <dd>
                    <UBadge
                      color="neutral"
                      variant="subtle"
                    >
                      {{ state.owner.kind === 'new' ? 'New account' : 'Existing account' }}
                    </UBadge>
                  </dd>
                </dl>
                <div class="mt-4 border-t border-default pt-4">
                  <h4 class="mb-2 text-sm font-semibold text-highlighted">
                    After creation
                  </h4>
                  <ol class="space-y-2 text-sm">
                    <li
                      v-for="(step, index) in steps"
                      :key="step"
                      class="flex items-start gap-2"
                    >
                      <span
                        class="flex size-5 shrink-0 items-center justify-center rounded-full bg-elevated text-xs font-medium text-highlighted"
                        aria-hidden="true"
                      >{{ index + 1 }}</span>
                      <span>{{ step }}</span>
                    </li>
                  </ol>
                </div>
              </UCard>
            </aside>
          </div>
        </UForm>

        <BottomActionBar
          label="Create cafe actions"
          expanded="pinned"
        >
          <div class="flex w-full flex-wrap items-center justify-between gap-2">
            <UButton
              label="Cancel"
              color="neutral"
              variant="outline"
              @click="leave()"
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
        </BottomActionBar>
      </div>
    </template>
  </UDashboardPanel>
</template>
