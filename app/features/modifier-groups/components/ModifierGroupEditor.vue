<script setup lang="ts">
/**
 * Edits one add-on group. Like the option-set editor (D67), **each change is saved at once** with
 * the version of the last answer, and the editor keeps the latest group it got back (`current`).
 *
 * Saving: the name and the rules each have a Save button once changed; an add-on's name and price
 * save together (Save, or Enter); "Pre-selected" saves when ticked. The last error is also shown
 * in the editor, because toasts can't be reached while the slide-over is open (D67): for a version
 * conflict it offers Reload.
 *
 * Open via `useOverlay().create(ModifierGroupEditor)`; emits `close`.
 */
import { moveArrayElement, useSortable } from '@vueuse/integrations/useSortable'
import * as v from 'valibot'
import type { Modifier, ModifierGroup } from '#shared/contracts/menu-modifiers'
import { MAX_MODIFIERS, selectionProblem } from '#shared/contracts/menu-modifiers'
import type { ModifierFields } from '../composables/useModifierGroups'
import { activeModifiers, archivedModifiers, fetchModifierGroup, useModifierGroupMutations } from '../composables/useModifierGroups'
import { addOnNameSchema, describeRules, groupNameSchema, priceSchema } from '../schemas/modifier-group-form'

const props = defineProps<{ group: ModifierGroup }>()
const emit = defineEmits<{ 'close': [], 'update:open': [open: boolean] }>()

const current = ref<ModifierGroup>(props.group)
const archived = computed(() => current.value.status === 'archived')
const active = computed(() => activeModifiers(current.value))
const hidden = computed(() => archivedModifiers(current.value))

interface AddOnDraft {
  name: string
  /** Dollars. */
  price?: number
}
const draftOf = (modifier: Modifier): AddOnDraft => ({ name: modifier.name, price: fromMinor(modifier.priceDeltaMinor) })

/** What's typed: the name, the rules, each add-on's name and price, a new add-on. */
const drafts = reactive({
  name: props.group.name,
  minSelect: props.group.minSelect,
  maxSelect: props.group.maxSelect as number | null,
  newAddOn: { name: '', price: undefined } as AddOnDraft,
  modifiers: Object.fromEntries(props.group.modifiers.map(m => [m.id, draftOf(m)])) as Record<string, AddOnDraft>,
})

/** Take the server's answer as the truth; the fields just saved show their saved values. */
function apply(group: ModifierGroup, saved: { name?: boolean, rules?: boolean, modifierId?: string } = {}) {
  current.value = group
  if (saved.name) drafts.name = group.name
  if (saved.rules) {
    drafts.minSelect = group.minSelect
    drafts.maxSelect = group.maxSelect
  }
  for (const modifier of group.modifiers) {
    if (!(modifier.id in drafts.modifiers) || saved.modifierId === modifier.id) drafts.modifiers[modifier.id] = draftOf(modifier)
  }
  order.value = activeModifiers(group).map(m => m.id)
}

const mutations = useModifierGroupMutations()
const busy = computed(() => mutations.isBusy(current.value.id))

// --- What's unsaved (the guard watches only this) ---
const addOnChanged = (modifier: Modifier) => {
  const draft = drafts.modifiers[modifier.id]
  return !!draft && (draft.name.trim() !== modifier.name || toMinor(draft.price ?? 0) !== modifier.priceDeltaMinor)
}
const nameChanged = computed(() => drafts.name.trim() !== current.value.name)
const rulesChanged = computed(() => drafts.minSelect !== current.value.minSelect || drafts.maxSelect !== current.value.maxSelect)
const pending = computed(() => ({
  name: nameChanged.value ? drafts.name : null,
  rules: rulesChanged.value ? [drafts.minSelect, drafts.maxSelect] : null,
  newAddOn: drafts.newAddOn.name.trim() || drafts.newAddOn.price ? { ...drafts.newAddOn } : null,
  modifiers: Object.fromEntries(current.value.modifiers.filter(addOnChanged).map(m => [m.id, { ...drafts.modifiers[m.id] }])),
}))
const unsaved = useModalUnsavedChanges(pending, {
  initial: { name: null, rules: null, newAddOn: null, modifiers: {} },
  close: () => emit('close'),
})

// --- The last error, shown here as well as in the toast ---
const lastError = ref<{ message: string, conflict: boolean } | null>(null)
function checked<T extends { ok: boolean, status?: string, error?: { code?: string, message: string } }>(result: T): T {
  if (result.ok) lastError.value = null
  else if (result.status === 'error' && result.error) lastError.value = { message: result.error.message, conflict: result.error.code === 'VERSION_CONFLICT' }
  return result
}

const notify = useNotify()
async function reload() {
  try {
    const fresh = await fetchModifierGroup(current.value.id)
    drafts.name = fresh.name
    drafts.minSelect = fresh.minSelect
    drafts.maxSelect = fresh.maxSelect
    drafts.modifiers = Object.fromEntries(fresh.modifiers.map(m => [m.id, draftOf(m)]))
    apply(fresh)
    lastError.value = null
  }
  catch (error) {
    notify.error('Could not reload the add-on group', error)
  }
}

// --- Checks before sending (the server checks again) ---
const firstIssue = (schema: v.GenericSchema, value: unknown) => v.safeParse(schema, value).issues?.[0]?.message
const nameError = computed(() => (nameChanged.value ? firstIssue(groupNameSchema, drafts.name) : undefined))
const rulesError = computed(() => {
  if (!rulesChanged.value) return undefined
  if (!Number.isInteger(drafts.minSelect) || drafts.minSelect < 0) return 'Enter a whole number of 0 or more'
  if (drafts.maxSelect !== null && (!Number.isInteger(drafts.maxSelect) || drafts.maxSelect < 1)) return 'The maximum must be at least 1'
  return selectionProblem({ minSelect: drafts.minSelect, maxSelect: drafts.maxSelect, active: active.value.length, defaults: active.value.filter(m => m.isDefault).length })?.message
})
const addOnError = (draft: AddOnDraft) => firstIssue(addOnNameSchema, draft.name) ?? firstIssue(priceSchema, draft.price)
const newAddOnError = computed(() => (drafts.newAddOn.name || drafts.newAddOn.price ? addOnError(drafts.newAddOn) : undefined))

// --- Actions: each one call, with the version of the latest answer ---
async function saveName() {
  if (!nameChanged.value || nameError.value) return
  const result = checked(await mutations.update.execute({ group: current.value, changes: { name: drafts.name.trim() } }))
  if (result.ok) apply(result.data, { name: true })
}

async function saveRules() {
  if (!rulesChanged.value || rulesError.value) return
  const result = checked(await mutations.update.execute({ group: current.value, changes: { minSelect: drafts.minSelect, maxSelect: drafts.maxSelect } }))
  if (result.ok) apply(result.data, { rules: true })
}

async function addAddOn() {
  if (!drafts.newAddOn.name.trim() || newAddOnError.value) return
  const fields = { name: drafts.newAddOn.name.trim(), priceDeltaMinor: toMinor(drafts.newAddOn.price ?? 0) }
  const result = checked(await mutations.addModifier.execute({ group: current.value, fields }))
  if (!result.ok) return
  drafts.newAddOn = { name: '', price: undefined }
  apply(result.data)
}

async function updateAddOn(modifier: Modifier, fields: ModifierFields) {
  const result = checked(await mutations.updateModifier.execute({ group: current.value, modifier, fields }))
  if (result.ok) apply(result.data, { modifierId: fields.name !== undefined || fields.priceDeltaMinor !== undefined ? modifier.id : undefined })
}

function saveAddOn(modifier: Modifier) {
  const draft = drafts.modifiers[modifier.id]!
  if (!addOnChanged(modifier) || addOnError(draft)) return
  const fields: ModifierFields = {}
  if (draft.name.trim() !== modifier.name) fields.name = draft.name.trim()
  if (toMinor(draft.price ?? 0) !== modifier.priceDeltaMinor) fields.priceDeltaMinor = toMinor(draft.price ?? 0)
  return updateAddOn(modifier, fields)
}

async function archiveAddOn(modifier: Modifier) {
  const result = checked(await mutations.archiveModifier.execute({ group: current.value, modifier }))
  if (result.ok) apply(result.data)
}

async function restoreAddOn(modifier: Modifier) {
  const result = checked(await mutations.restoreModifier.execute({ group: current.value, modifier }))
  if (result.ok) apply(result.data)
}

async function restoreGroup() {
  const result = checked(await mutations.restore.execute({ group: current.value }))
  if (result.ok) apply(result.data)
}

// --- Order: drag a handle, or ↑/↓ on it; saved on drop ---
const order = ref<string[]>(active.value.map(m => m.id))
const modifierById = (id: string) => current.value.modifiers.find(m => m.id === id)!

async function saveOrder(previous: string[]) {
  const result = checked(await mutations.reorderModifiers.execute({ group: current.value, modifierIds: [...order.value] }))
  if (result.ok) apply(result.data)
  else order.value = previous
}

const listEl = useTemplateRef<HTMLElement>('listEl')
const sortable = useSortable(listEl, order, {
  handle: '[data-modifier-handle]',
  animation: 150,
  onUpdate: (event) => {
    const previous = [...order.value]
    moveArrayElement(order, event.oldIndex!, event.newIndex!, event)
    nextTick(() => saveOrder(previous))
  },
})
watch([busy, archived], ([isBusy, isArchived]) => sortable.option('disabled', isBusy || isArchived), { immediate: true })

async function onHandleKey(event: KeyboardEvent, index: number) {
  const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : undefined
  if (to === undefined) return
  event.preventDefault()
  if (to < 0 || to >= order.value.length || busy.value) return
  const previous = [...order.value]
  const list = [...order.value]
  const [moved] = list.splice(index, 1)
  list.splice(to, 0, moved!)
  order.value = list
  await saveOrder(previous)
  await nextTick()
  listEl.value?.querySelector<HTMLElement>(`[data-modifier-handle="${moved}"]`)?.focus()
}

const noLimit = computed({
  get: () => drafts.maxSelect === null,
  set: (value: boolean) => {
    drafts.maxSelect = value ? null : Math.max(1, drafts.minSelect)
  },
})
</script>

<template>
  <USlideover
    :title="current.name"
    :description="archived ? 'Archived: restore it to edit.' : 'Changes are saved as you make them.'"
    :ui="{ content: 'sm:max-w-xl' }"
    @update:open="unsaved.onOpenChange"
  >
    <template #body>
      <div class="space-y-6">
        <UAlert
          v-if="lastError"
          :color="lastError.conflict ? 'warning' : 'error'"
          variant="subtle"
          :title="lastError.conflict ? 'Someone else changed this add-on group' : 'That change wasn\'t saved'"
          :description="lastError.conflict ? 'Reload it to see their changes, then try again.' : lastError.message"
          :actions="lastError.conflict ? [{ label: 'Reload', onClick: reload }] : []"
        />

        <UAlert
          v-if="archived"
          color="neutral"
          variant="subtle"
          title="This add-on group is archived"
          description="Menu items that offer it keep it, but it can't be added to others."
          :actions="[{ label: 'Restore', loading: busy, onClick: restoreGroup }]"
        />

        <UFormField
          label="Name"
          :error="nameError"
        >
          <div class="flex gap-2">
            <UInput
              v-model="drafts.name"
              :disabled="archived"
              class="flex-1"
              @keydown.enter.prevent="saveName"
            />
            <UButton
              v-if="nameChanged"
              label="Save name"
              :disabled="busy || !!nameError"
              @click="saveName"
            />
          </div>
        </UFormField>

        <fieldset
          class="space-y-2"
          :disabled="archived"
        >
          <legend class="text-sm font-medium">
            How many customers choose
          </legend>
          <div class="flex flex-wrap items-end gap-3">
            <UFormField label="At least">
              <UInputNumber
                v-model="drafts.minSelect"
                :min="0"
                :max="MAX_MODIFIERS"
                aria-label="At least"
                class="w-28"
              />
            </UFormField>
            <UFormField label="At most">
              <UInputNumber
                v-if="!noLimit"
                :model-value="drafts.maxSelect ?? undefined"
                :min="1"
                :max="MAX_MODIFIERS"
                aria-label="At most"
                class="w-28"
                @update:model-value="value => drafts.maxSelect = value ?? 1"
              />
              <p
                v-else
                class="flex h-8 items-center text-sm text-muted"
              >
                No limit
              </p>
            </UFormField>
            <UCheckbox
              v-model="noLimit"
              label="No limit"
              class="pb-1.5"
            />
            <UButton
              v-if="rulesChanged"
              label="Save rules"
              :disabled="busy || !!rulesError"
              @click="saveRules"
            />
          </div>
          <p
            v-if="rulesError"
            class="text-sm text-error"
          >
            {{ rulesError }}
          </p>
          <p
            v-else
            class="text-xs text-muted"
          >
            {{ describeRules(drafts.minSelect, drafts.maxSelect) }}. Items can use their own rules.
          </p>
        </fieldset>

        <div class="space-y-2">
          <p class="text-sm font-medium">
            Add-ons
            <span class="font-normal text-muted">({{ active.length }} of {{ MAX_MODIFIERS }})</span>
          </p>
          <p class="text-xs text-muted">
            Default prices: items can set their own. Drag the handle (or press ↑/↓ on it) to reorder.
          </p>
          <ul
            ref="listEl"
            class="space-y-2"
          >
            <li
              v-for="(id, i) in order"
              :key="id"
              :aria-label="modifierById(id).name"
              class="space-y-1"
            >
              <div class="flex items-center gap-2">
                <UButton
                  icon="i-lucide-grip-vertical"
                  color="neutral"
                  variant="ghost"
                  :data-modifier-handle="id"
                  :aria-label="`Move ${modifierById(id).name}`"
                  :disabled="busy || archived"
                  class="cursor-grab"
                  @keydown="onHandleKey($event, i)"
                />
                <UInput
                  v-model="drafts.modifiers[id]!.name"
                  :aria-label="`Name of ${modifierById(id).name}`"
                  :disabled="archived"
                  class="flex-1"
                  @keydown.enter.prevent="saveAddOn(modifierById(id))"
                />
                <UInputNumber
                  :model-value="drafts.modifiers[id]!.price"
                  :format-options="PRICE_FORMAT"
                  :min="0"
                  :step="0.05"
                  :aria-label="`Price of ${modifierById(id).name}`"
                  :disabled="archived"
                  class="w-28"
                  @update:model-value="value => drafts.modifiers[id]!.price = value ?? undefined"
                  @keydown.enter.prevent="saveAddOn(modifierById(id))"
                />
                <UCheckbox
                  :model-value="modifierById(id).isDefault"
                  label="Pre-selected"
                  :aria-label="`Pre-select ${modifierById(id).name}`"
                  :disabled="busy || archived"
                  @update:model-value="value => updateAddOn(modifierById(id), { isDefault: !!value })"
                />
                <UButton
                  v-if="addOnChanged(modifierById(id))"
                  label="Save"
                  :disabled="busy || !!addOnError(drafts.modifiers[id]!)"
                  @click="saveAddOn(modifierById(id))"
                />
                <UTooltip :text="active.length <= 1 ? 'A group needs at least one add-on: archive the group instead' : 'Archive'">
                  <UButton
                    icon="i-lucide-archive"
                    color="neutral"
                    variant="ghost"
                    :aria-label="`Archive ${modifierById(id).name}`"
                    :disabled="busy || archived || active.length <= 1"
                    @click="archiveAddOn(modifierById(id))"
                  />
                </UTooltip>
              </div>
              <p
                v-if="addOnChanged(modifierById(id)) && addOnError(drafts.modifiers[id]!)"
                class="ml-10 text-sm text-error"
              >
                {{ addOnError(drafts.modifiers[id]!) }}
              </p>
            </li>
          </ul>

          <div
            v-if="!archived"
            class="space-y-1"
          >
            <div class="flex gap-2">
              <UInput
                v-model="drafts.newAddOn.name"
                placeholder="New add-on, e.g. Oat milk"
                aria-label="New add-on"
                class="flex-1"
                :disabled="active.length >= MAX_MODIFIERS"
                @keydown.enter.prevent="addAddOn"
              />
              <UInputNumber
                :model-value="drafts.newAddOn.price"
                :format-options="PRICE_FORMAT"
                :min="0"
                :step="0.05"
                placeholder="Free"
                aria-label="Price of new add-on"
                class="w-28"
                @update:model-value="value => drafts.newAddOn.price = value ?? undefined"
              />
              <UButton
                label="Add"
                icon="i-lucide-plus"
                :disabled="busy || !drafts.newAddOn.name.trim() || !!newAddOnError || active.length >= MAX_MODIFIERS"
                @click="addAddOn"
              />
            </div>
            <p
              v-if="newAddOnError"
              class="text-sm text-error"
            >
              {{ newAddOnError }}
            </p>
          </div>
        </div>

        <div
          v-if="hidden.length"
          class="space-y-2"
        >
          <p class="text-sm font-medium">
            Archived add-ons
          </p>
          <ul class="space-y-1">
            <li
              v-for="modifier in hidden"
              :key="modifier.id"
              :aria-label="modifier.name"
              class="flex items-center justify-between gap-2 text-sm"
            >
              <span class="text-muted">{{ modifier.name }} · {{ formatMinor(modifier.priceDeltaMinor) }}</span>
              <UButton
                label="Restore"
                size="xs"
                variant="soft"
                :disabled="busy || archived || active.length >= MAX_MODIFIERS"
                @click="restoreAddOn(modifier)"
              />
            </li>
          </ul>
        </div>

        <p class="text-sm text-muted">
          {{ current.itemCount ? `Offered by ${pluralize(current.itemCount, ['menu item', 'menu items'])}.` : 'Not offered by any menu item yet.' }}
        </p>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end">
        <UButton
          label="Done"
          color="neutral"
          variant="outline"
          @click="unsaved.requestClose()"
        />
      </div>
    </template>
  </USlideover>
</template>
