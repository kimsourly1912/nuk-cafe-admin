<script setup lang="ts">
/**
 * Add a staff member, or change someone's access (D49, D52). Open via
 * `useOverlay().create(StaffFormModal)`; emits `close(true)` when saved.
 *
 * Access is one choice (D196): Admin, Manager or Staff at the ticked branches, or a different role
 * per branch (offered with two branches or more); saving replaces all of it and signs the person
 * out on their devices. A new account's temporary password is shown once afterwards. Like the other
 * forms, it stays open while saving but can be closed: the save continues, and a failure offers
 * "Reopen" with the input restored.
 */
import type { FormSubmitEvent, RadioGroupItem, SelectItem } from '@nuxt/ui'
import type { StaffMember } from '#shared/contracts/staff'
import { BRANCH_ROLES } from '#shared/contracts/staff'
import { useAuth } from '~/features/auth'
import { useBranchOptions } from '~/features/branches'
import { useStaffMutations } from '../composables/useStaff'
import { ACCESS_CHOICES, ACCESS_LABELS, isBranchRole, ROLE_LABELS, staffAccessFormSchema, staffCreateFormSchema, switchAccess, toCreateStaffBody, toStaffForm, toUpdateStaffAccessBody } from '../schemas/staff-form'
import type { AccessChoice, StaffForm } from '../schemas/staff-form'
import StaffFormModal from './StaffFormModal.vue'
import TemporaryPasswordModal from './TemporaryPasswordModal.vue'

const props = defineProps<{
  /** Omit to add someone. */
  member?: StaffMember
  /** Restores unsaved input (used by "Reopen" after a failed background save). */
  draft?: StaffForm
}>()
const emit = defineEmits<{ 'close': [saved: boolean], 'update:open': [open: boolean] }>()

const { isCompact } = useLayoutContext()
const isEdit = props.member !== undefined
const isSelf = isEdit && useAuth().user.value?.userId === props.member!.id
// An admin can't remove their own admin role (the server refuses too: OWN_ACCESS).
const adminLocked = isSelf && props.member!.admin

const state = reactive<StaffForm>(structuredClone(toRaw(props.draft) ?? toStaffForm(props.member)))
// Both validate the same `StaffForm`; editing doesn't change the name or email.
const schema = (isEdit ? staffAccessFormSchema : staffCreateFormSchema) as typeof staffCreateFormSchema

const branches = useBranchOptions()
// A branch the person still has but that's no longer active stays listed, so it can be unticked.
const branchItems = computed(() => {
  const items = (branches.data.value ?? []).map(b => ({ label: b.name, value: b.id }))
  const gone = (props.member?.memberships ?? []).filter(m => !items.some(i => i.value === m.branchId))
  return [...items, ...gone.map(m => ({ label: m.branchName, value: m.branchId }))]
})
const roleItems: SelectItem[] = BRANCH_ROLES.map(role => ({ label: ROLE_LABELS[role], value: role }))
const unusedBranch = computed(() => branches.data.value?.find(b => !state.memberships.some(m => m.branchId === b.id)))

// "Different per branch" only means something with two branches (or when they already have it).
const accessItems = computed<RadioGroupItem[]>(() => ACCESS_CHOICES
  .filter(choice => choice !== 'mixed' || branchItems.value.length > 1 || state.access === 'mixed')
  .map(choice => ({ value: choice, ...ACCESS_LABELS[choice], disabled: adminLocked && choice !== 'admin' })))

function onAccessChange(next: AccessChoice) {
  Object.assign(state, switchAccess(state, next))
}

function toggleBranch(branchId: string, on: boolean) {
  state.branchIds = on ? [...state.branchIds, branchId] : state.branchIds.filter(id => id !== branchId)
}
// Each checkbox its own id: inside the branchIds field they'd all take the field's.
const formId = useId()

function addMembership() {
  if (unusedBranch.value) state.memberships.push({ branchId: unusedBranch.value.id, role: 'staff' })
}

const { create, updateAccess } = useStaffMutations()
const saving = ref(false)

const unsaved = useModalUnsavedChanges(state, {
  initial: toStaffForm(props.member),
  paused: saving,
  close: () => emit('close', false),
})

const form = useTemplateRef('form')
useFormErrorRecheck(form)
const rowErrors = useFormRowErrors(form, 'memberships')
useSubmitShortcut(() => form.value?.submit())

let closed = false
onUnmounted(() => {
  closed = true
})
const overlay = useOverlay()
const passwordModal = overlay.create(TemporaryPasswordModal)
function reopenActions(draft: StaffForm) {
  if (!closed) return []
  return [{
    label: 'Reopen',
    onClick: () => overlay.create(StaffFormModal, { destroyOnClose: true }).open({ member: props.member, draft }),
  }]
}

async function onSubmit({ data }: FormSubmitEvent<StaffForm>) {
  const draft = structuredClone(toRaw(state))
  const overrides = { errorActions: () => reopenActions(draft) }

  saving.value = true
  if (props.member) {
    const result = await updateAccess.execute({ member: props.member, body: toUpdateStaffAccessBody(data, props.member) }, overrides)
    saving.value = false
    if (!result.ok) return
  }
  else {
    const result = await create.execute(toCreateStaffBody(data), overrides)
    saving.value = false
    if (!result.ok) return
    const { staff, temporaryPassword } = result.data
    // Shown even if this form was closed while saving: it's the only time it can be read.
    if (temporaryPassword) void passwordModal.open({ name: staff.name, email: staff.email, password: temporaryPassword })
  }
  unsaved.markClean()
  emit('close', true)
}
</script>

<template>
  <AppModal
    :title="isEdit ? `Access of ${member!.name}` : 'Add staff member'"
    :description="isEdit ? member!.email : undefined"
    :fullscreen="isCompact"
    :ui="{ footer: 'pb-[max(env(safe-area-inset-bottom),1rem)]' }"
    @update:open="unsaved.onOpenChange"
  >
    <template #body>
      <UForm
        id="staff-form"
        ref="form"
        :schema="schema"
        :state="state"
        :validate-on="['input', 'change']"
        :disabled="saving"
        class="space-y-5"
        @submit="onSubmit"
        @error="focusFirstInvalid"
      >
        <template v-if="!isEdit">
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
            label="Email"
            name="email"
            help="If this email already has a customer account, that account gets the access and keeps its password."
            required
          >
            <UInput
              v-model="state.email"
              type="email"
              class="w-full"
            />
          </UFormField>
        </template>

        <UFormField
          label="Access"
          name="access"
          :help="adminLocked ? 'You can\'t remove your own admin role.' : undefined"
        >
          <URadioGroup
            :model-value="state.access"
            :items="accessItems"
            variant="card"
            legend="Access"
            :ui="{ legend: 'sr-only' }"
            @update:model-value="value => onAccessChange(value as AccessChoice)"
          />
        </UFormField>

        <ApiErrorAlert
          v-if="state.access !== 'admin' && branches.error.value"
          :error="branches.error.value"
          title="Could not load branches"
          @retry="branches.refresh()"
        />

        <UFormField
          v-if="isBranchRole(state.access)"
          label="Branches"
          name="branchIds"
          :description="`They work the counter of these branches as ${ROLE_LABELS[state.access]}.`"
        >
          <div class="grid gap-2 sm:grid-cols-2">
            <UCheckbox
              v-for="branch in branchItems"
              :id="`${formId}-branch-${branch.value}`"
              :key="branch.value"
              :model-value="state.branchIds.includes(branch.value)"
              :label="branch.label"
              :aria-label="branch.label"
              @update:model-value="on => toggleBranch(branch.value, on === true)"
            />
          </div>
        </UFormField>

        <UFormField
          v-else-if="state.access === 'mixed'"
          label="Branches"
          name="memberships"
          description="Pick each branch and their role there."
        >
          <div class="space-y-2">
            <div
              v-for="(membership, index) in state.memberships"
              :key="index"
              class="flex items-start gap-2"
            >
              <UFormField
                :name="`memberships.${index}.branchId`"
                class="flex-1"
              >
                <RecordSelect
                  v-model="membership.branchId"
                  :items="branchItems"
                  noun="branches"
                  :aria-label="`Branch ${index + 1}`"
                  class="w-full"
                />
              </UFormField>
              <USelect
                v-model="membership.role"
                :items="roleItems"
                :aria-label="`Role at branch ${index + 1}`"
                class="w-32"
              />
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                :aria-label="`Remove branch ${index + 1}`"
                @click="rowErrors.removeRow(state.memberships, index)"
              />
            </div>
            <UButton
              label="Add branch"
              icon="i-lucide-plus"
              color="neutral"
              variant="outline"
              size="sm"
              :disabled="!unusedBranch"
              @click="addMembership"
            />
          </div>
        </UFormField>

        <p
          v-if="isEdit && !isSelf"
          class="text-xs text-muted"
        >
          Saving signs {{ member!.name }} out on all their devices.
        </p>
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
          :text="isEdit ? 'Save' : 'Add'"
          :kbds="['meta', 'enter']"
        >
          <UButton
            type="submit"
            form="staff-form"
            :label="isEdit ? 'Save' : 'Add'"
            :loading="saving"
          />
        </UTooltip>
      </div>
    </template>
  </AppModal>
</template>
