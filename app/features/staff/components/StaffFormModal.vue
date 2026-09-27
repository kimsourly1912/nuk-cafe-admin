<script setup lang="ts">
/**
 * Add a staff member, or change someone's access (D49, D52). Open via
 * `useOverlay().create(StaffFormModal)`; emits `close(true)` when saved.
 *
 * Access is the admin role plus one role per branch; saving replaces all of it and signs the person
 * out on their devices. A new account's temporary password is shown once afterwards. Like the other
 * forms, it stays open while saving but can be closed: the save continues, and a failure offers
 * "Reopen" with the input restored.
 */
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'
import type { StaffMember } from '#shared/contracts/staff'
import { BRANCH_ROLES } from '#shared/contracts/staff'
import { useAuth } from '~/features/auth'
import { useBranchOptions, useStaffMutations } from '../composables/useStaff'
import { ROLE_LABELS, staffAccessFormSchema, staffCreateFormSchema, toCreateStaffBody, toStaffForm, toUpdateStaffAccessBody } from '../schemas/staff-form'
import type { StaffForm } from '../schemas/staff-form'
import StaffFormModal from './StaffFormModal.vue'
import TemporaryPasswordModal from './TemporaryPasswordModal.vue'

const props = defineProps<{
  /** Omit to add someone. */
  member?: StaffMember
  /** Restores unsaved input (used by "Reopen" after a failed background save). */
  draft?: StaffForm
}>()
const emit = defineEmits<{ 'close': [saved: boolean], 'update:open': [open: boolean] }>()

const isEdit = props.member !== undefined
const isSelf = isEdit && useAuth().user.value?.userId === props.member!.id
// An admin can't remove their own admin role (the server refuses too: OWN_ACCESS).
const adminLocked = isSelf && props.member!.admin

const state = reactive<StaffForm>(structuredClone(toRaw(props.draft) ?? toStaffForm(props.member)))
// Both validate the same `StaffForm`; editing doesn't change the name or email.
const schema = (isEdit ? staffAccessFormSchema : staffCreateFormSchema) as typeof staffCreateFormSchema

const branches = useBranchOptions()
const branchItems = computed<SelectItem[]>(() => (branches.data.value ?? []).map(b => ({ label: b.name, value: b.id })))
const roleItems: SelectItem[] = BRANCH_ROLES.map(role => ({ label: ROLE_LABELS[role], value: role }))
const unusedBranch = computed(() => branches.data.value?.find(b => !state.memberships.some(m => m.branchId === b.id)))

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
  <UModal
    :title="isEdit ? `Access of ${member!.name}` : 'Add staff member'"
    :description="isEdit ? member!.email : undefined"
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

        <UFormField name="admin">
          <USwitch
            v-model="state.admin"
            label="Admin"
            :description="adminLocked ? 'You can\'t remove your own admin role.' : 'Everything in this app: menu, staff, settings, refunds, reports.'"
            :disabled="adminLocked"
          />
        </UFormField>

        <UFormField
          label="Branches"
          name="memberships"
          description="Managers and staff work at the counter of these branches."
        >
          <div class="space-y-2">
            <ApiErrorAlert
              v-if="branches.error.value"
              :error="branches.error.value"
              title="Could not load branches"
              @retry="branches.refresh()"
            />
            <div
              v-for="(membership, index) in state.memberships"
              :key="index"
              class="flex items-start gap-2"
            >
              <UFormField
                :name="`memberships.${index}.branchId`"
                class="flex-1"
              >
                <USelect
                  v-model="membership.branchId"
                  :items="branchItems"
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
                @click="state.memberships.splice(index, 1)"
              />
            </div>
            <p
              v-if="!state.memberships.length"
              class="text-sm text-muted"
            >
              No branch.
            </p>
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
      <div class="flex w-full items-center justify-end gap-2">
        <span
          v-if="saving"
          class="mr-auto text-xs text-muted"
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
  </UModal>
</template>
