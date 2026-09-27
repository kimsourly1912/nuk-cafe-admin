<script setup lang="ts">
/**
 * Edits one option set. **Each change is saved at once** (D66): the API has one call per action and
 * answers with the whole set, whose `version` the next call sends. So the editor keeps the latest
 * set it got back (`current`) instead of a draft of everything.
 *
 * Typed-but-unsaved text (the name, a value's new name, a value to add) is what the
 * unsaved-changes guard watches: closing with any of it asks first.
 *
 * Open via `useOverlay().create(OptionSetEditor)`; emits `close`.
 */
import { moveArrayElement, useSortable } from '@vueuse/integrations/useSortable'
import type { OptionSet, OptionValue } from '#shared/contracts/menu-options'
import { MAX_OPTION_VALUES } from '#shared/contracts/menu-options'
import { activeValues, archivedValues, fetchOptionSet, useOptionSetMutations } from '../composables/useOptionSets'
import { setNameSchema, valueNameSchema } from '../schemas/option-set-form'
import * as v from 'valibot'

const props = defineProps<{ set: OptionSet }>()
const emit = defineEmits<{ 'close': [], 'update:open': [open: boolean] }>()

const current = ref<OptionSet>(props.set)
const archived = computed(() => current.value.status === 'archived')
const active = computed(() => activeValues(current.value))
const hidden = computed(() => archivedValues(current.value))

/** What's typed: the set's name, each value's name, a new value. */
const drafts = reactive({
  name: props.set.name,
  newValue: '',
  values: Object.fromEntries(props.set.values.map(value => [value.id, value.name])) as Record<string, string>,
})

/** Take the server's answer as the truth: new values get a draft; renamed fields show their new name. */
function apply(set: OptionSet, renamed: { set?: boolean, valueId?: string } = {}) {
  current.value = set
  if (renamed.set) drafts.name = set.name
  for (const value of set.values) {
    if (!(value.id in drafts.values) || renamed.valueId === value.id) drafts.values[value.id] = value.name
  }
}

const mutations = useOptionSetMutations()
const busy = computed(() => mutations.isBusy(current.value.id))

// Only edits not saved yet: saving one of them clears it, and leaves the others watched.
const pending = computed(() => ({
  name: drafts.name.trim() !== current.value.name ? drafts.name : null,
  newValue: drafts.newValue.trim() || null,
  values: Object.fromEntries(current.value.values.filter(value => drafts.values[value.id]?.trim() !== value.name).map(value => [value.id, drafts.values[value.id]])),
}))
const unsaved = useModalUnsavedChanges(pending, {
  initial: { name: null, newValue: null, values: {} },
  close: () => emit('close'),
})

// --- Reload after someone else changed the set (409) ---
// Shown in the editor, not as a toast action: while the slide-over is open the toasts sit outside
// the modal (aria-hidden), so their buttons can't be reached by keyboard or screen reader.
const conflict = ref(false)
const notify = useNotify()
async function reload() {
  try {
    const fresh = await fetchOptionSet(current.value.id)
    current.value = fresh
    drafts.name = fresh.name
    drafts.values = Object.fromEntries(fresh.values.map(value => [value.id, value.name]))
    order.value = activeValues(fresh).map(value => value.id)
    conflict.value = false
  }
  catch (error) {
    notify.error('Could not reload the option set', error)
  }
}
/** Notes a version conflict (someone else saved first); passes the result on. */
function checked<T extends { ok: boolean, status?: string, error?: { code?: string } }>(result: T): T {
  if (!result.ok && result.status === 'error' && result.error?.code === 'VERSION_CONFLICT') conflict.value = true
  return result
}

// --- Actions: each one call, with the version of the latest answer ---
const nameError = computed(() => v.safeParse(setNameSchema, drafts.name).issues?.[0]?.message)
const newValueError = computed(() => (drafts.newValue ? v.safeParse(valueNameSchema, drafts.newValue).issues?.[0]?.message : undefined))
const valueError = (value: OptionValue) => v.safeParse(valueNameSchema, drafts.values[value.id] ?? '').issues?.[0]?.message

async function saveName() {
  if (nameError.value || !pending.value.name) return
  const result = checked(await mutations.rename.execute({ set: current.value, name: drafts.name.trim() }))
  if (result.ok) apply(result.data, { set: true })
}

async function addValue() {
  const name = drafts.newValue.trim()
  if (!name || newValueError.value) return
  const result = checked(await mutations.addValue.execute({ set: current.value, name }))
  if (!result.ok) return
  drafts.newValue = ''
  apply(result.data)
  order.value = activeValues(result.data).map(value => value.id)
}

async function renameValue(value: OptionValue) {
  const name = drafts.values[value.id]?.trim() ?? ''
  if (name === value.name || valueError(value)) return
  const result = checked(await mutations.renameValue.execute({ set: current.value, value, name }))
  if (result.ok) apply(result.data, { valueId: value.id })
}

async function archiveValue(value: OptionValue) {
  const result = checked(await mutations.archiveValue.execute({ set: current.value, value }))
  if (!result.ok) return
  apply(result.data)
  order.value = activeValues(result.data).map(v => v.id)
}

async function restoreValue(value: OptionValue) {
  const result = checked(await mutations.restoreValue.execute({ set: current.value, value }))
  if (!result.ok) return
  apply(result.data)
  order.value = activeValues(result.data).map(v => v.id)
}

async function restoreSet() {
  const result = checked(await mutations.restore.execute({ set: current.value }))
  if (result.ok) apply(result.data)
}

// --- Order: drag a handle, or ↑/↓ on it; saved on drop ---
const order = ref<string[]>(active.value.map(value => value.id))
const valueById = (id: string) => current.value.values.find(value => value.id === id)!

async function saveOrder(previous: string[]) {
  const result = checked(await mutations.reorderValues.execute({ set: current.value, valueIds: [...order.value] }))
  if (result.ok) apply(result.data)
  else order.value = previous
}

const listEl = useTemplateRef<HTMLElement>('listEl')
const sortable = useSortable(listEl, order, {
  handle: '[data-value-handle]',
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
  listEl.value?.querySelector<HTMLElement>(`[data-value-handle="${moved}"]`)?.focus()
}
</script>

<template>
  <USlideover
    :title="current.name"
    :description="archived ? 'Archived: restore it to edit.' : 'Changes are saved as you make them.'"
    @update:open="unsaved.onOpenChange"
  >
    <template #body>
      <div class="space-y-6">
        <UAlert
          v-if="conflict"
          color="warning"
          variant="subtle"
          title="Someone else changed this option set"
          description="Reload it to see their changes, then try again."
          :actions="[{ label: 'Reload', onClick: reload }]"
        />

        <UAlert
          v-if="archived"
          color="neutral"
          variant="subtle"
          title="This option set is archived"
          description="Menu items that use it keep it, but it can't be added to others."
          :actions="[{ label: 'Restore', loading: busy, onClick: restoreSet }]"
        />

        <UFormField
          label="Name"
          :error="drafts.name !== current.name ? nameError : undefined"
        >
          <div class="flex gap-2">
            <UInput
              v-model="drafts.name"
              :disabled="archived"
              class="flex-1"
              @keydown.enter.prevent="saveName"
            />
            <UButton
              v-if="pending.name !== null"
              label="Save name"
              :loading="mutations.rename.isPending(`option-set:${current.id}`)"
              :disabled="busy || !!nameError"
              @click="saveName"
            />
          </div>
        </UFormField>

        <div class="space-y-2">
          <p class="text-sm font-medium">
            Values
            <span class="font-normal text-muted">({{ active.length }} of {{ MAX_OPTION_VALUES }})</span>
          </p>
          <p class="text-xs text-muted">
            Drag the handle (or press ↑/↓ on it) to reorder; menu items show values in this order.
          </p>
          <ul
            ref="listEl"
            class="space-y-2"
          >
            <li
              v-for="(id, i) in order"
              :key="id"
              :aria-label="valueById(id).name"
              class="flex items-start gap-2"
            >
              <UButton
                icon="i-lucide-grip-vertical"
                color="neutral"
                variant="ghost"
                :data-value-handle="id"
                :aria-label="`Move ${valueById(id).name}`"
                :disabled="busy || archived"
                class="cursor-grab"
                @keydown="onHandleKey($event, i)"
              />
              <UFormField
                :error="drafts.values[id] !== valueById(id).name ? valueError(valueById(id)) : undefined"
                class="flex-1"
              >
                <UInput
                  v-model="drafts.values[id]"
                  :aria-label="`Name of ${valueById(id).name}`"
                  :disabled="archived"
                  class="w-full"
                  @keydown.enter.prevent="renameValue(valueById(id))"
                />
              </UFormField>
              <UButton
                v-if="pending.values[id] !== undefined"
                label="Save"
                :disabled="busy || !!valueError(valueById(id))"
                @click="renameValue(valueById(id))"
              />
              <UTooltip :text="active.length <= 1 ? 'A set needs at least one value: archive the set instead' : 'Archive'">
                <UButton
                  icon="i-lucide-archive"
                  color="neutral"
                  variant="ghost"
                  :aria-label="`Archive ${valueById(id).name}`"
                  :disabled="busy || archived || active.length <= 1"
                  @click="archiveValue(valueById(id))"
                />
              </UTooltip>
            </li>
          </ul>

          <UFormField
            v-if="!archived"
            :error="newValueError"
          >
            <div class="flex gap-2">
              <UInput
                v-model="drafts.newValue"
                placeholder="New value, e.g. Extra large"
                aria-label="New value"
                class="flex-1"
                :disabled="active.length >= MAX_OPTION_VALUES"
                @keydown.enter.prevent="addValue"
              />
              <UButton
                label="Add"
                icon="i-lucide-plus"
                :disabled="busy || !drafts.newValue.trim() || !!newValueError || active.length >= MAX_OPTION_VALUES"
                @click="addValue"
              />
            </div>
          </UFormField>
          <p
            v-if="!archived && active.length >= MAX_OPTION_VALUES"
            class="text-xs text-muted"
          >
            A set can have at most {{ MAX_OPTION_VALUES }} active values.
          </p>
        </div>

        <div
          v-if="hidden.length"
          class="space-y-2"
        >
          <p class="text-sm font-medium">
            Archived values
          </p>
          <p class="text-xs text-muted">
            Menu item versions that use them are hidden until they're restored.
          </p>
          <ul class="space-y-1">
            <li
              v-for="value in hidden"
              :key="value.id"
              :aria-label="value.name"
              class="flex items-center justify-between gap-2 text-sm"
            >
              <span class="text-muted">{{ value.name }}</span>
              <UButton
                label="Restore"
                size="xs"
                variant="soft"
                :disabled="busy || archived || active.length >= MAX_OPTION_VALUES"
                @click="restoreValue(value)"
              />
            </li>
          </ul>
        </div>

        <p class="text-sm text-muted">
          {{ current.itemCount ? `Used by ${pluralize(current.itemCount, ['menu item', 'menu items'])}.` : 'Not used by any menu item yet.' }}
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
