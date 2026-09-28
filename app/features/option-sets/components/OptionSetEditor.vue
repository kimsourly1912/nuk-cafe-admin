<script setup lang="ts">
/**
 * Edits one option set (D67, redesigned in D73). **Each change is saved at once**: the API has one
 * call per action and answers with the whole set, whose `version` the next call sends. So the
 * editor keeps the latest set it got back (`current`) instead of a draft of everything.
 *
 * - The header says what's happening: "Saving…", "Saved" or "Couldn't save".
 * - Browse mode: the name and each value are read-only until Edit / Rename opens an inline edit
 *   (one at a time; Enter saves, Escape cancels only that edit). "Add value" opens one too.
 *   Typed-but-unsaved text is what the unsaved-changes guard watches.
 * - Reorder mode: drag, ↑/↓ on a handle, or Move up / Move down. The order is saved shortly after
 *   the last move (`createOrderAutosave`); a refused save puts back the saved order and stays in
 *   the mode, with Reload after a version conflict.
 * - Errors show inside the editor: while it's open, toasts sit outside it (aria-hidden).
 * - An archived set is read-only, with Restore.
 * - Right slide-over on wide screens, full screen on phones.
 *
 * Open via `useOverlay().create(OptionSetEditor)`; emits `close`.
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { OptionSet, OptionValue } from '#shared/contracts/menu-options'
import { MAX_OPTION_VALUES } from '#shared/contracts/menu-options'
import { insertNodeAt, removeNode, useSortable } from '@vueuse/integrations/useSortable'
import * as v from 'valibot'
import { activeValues, archivedValues, fetchOptionSet, useOptionSetMutations } from '../composables/useOptionSets'
import { moveEntry, usageLabel } from '../schemas/option-set-display'
import { setNameSchema, valueNameSchema } from '../schemas/option-set-form'
import { createOrderAutosave } from '../utils/order-autosave'
import OptionInlineEdit from './OptionInlineEdit.vue'
import OptionValueRow from './OptionValueRow.vue'

const props = defineProps<{ set: OptionSet }>()
const emit = defineEmits<{ 'close': [], 'update:open': [open: boolean] }>()

const current = ref<OptionSet>(props.set)
const archived = computed(() => current.value.status === 'archived')
const active = computed(() => activeValues(current.value))
const hidden = computed(() => archivedValues(current.value))
const full = computed(() => active.value.length >= MAX_OPTION_VALUES)
const valueById = (id: string) => current.value.values.find(value => value.id === id)

const mutations = useOptionSetMutations()
const busy = computed(() => mutations.isBusy(current.value.id))
const confirm = useConfirm()
const notify = useNotify()

// --- What the header says, and the last error (shown in the editor) ---
const lastError = ref<{ message: string, conflict: boolean } | null>(null)
const savedOnce = ref(false)
const reorderPending = ref(false)
const status = computed(() => (busy.value || reorderPending.value ? 'saving' : lastError.value ? 'error' : savedOnce.value ? 'saved' : 'idle'))

/** Notes the outcome of a change for the header and the alert; passes the result on. */
function checked<T extends { ok: boolean, status?: string, error?: { code?: string, message: string } }>(result: T): T {
  if (result.ok) {
    lastError.value = null
    savedOnce.value = true
  }
  else if (result.status === 'error' && result.error) {
    lastError.value = { message: result.error.message, conflict: result.error.code === 'VERSION_CONFLICT' }
  }
  return result
}

const errorEl = useTemplateRef<HTMLElement>('errorEl')
watch(lastError, async (error) => {
  if (!error) return
  await nextTick()
  errorEl.value?.scrollIntoView?.({ block: 'nearest' })
})

async function reload() {
  try {
    const fresh = await fetchOptionSet(current.value.id)
    autosave.cancel()
    current.value = fresh
    syncOrder()
    lastError.value = null
    const edit = editing.value
    if (edit?.kind === 'value' && valueById(edit.id)?.status !== 'active') stopEdit()
  }
  catch (error) {
    notify.error('Could not reload the option set', error)
  }
}

// --- Inline edits: the name, one value's name, or a new value (one at a time) ---
type Edit = { kind: 'name' } | { kind: 'add' } | { kind: 'value', id: string }
const editing = ref<Edit | null>(null)
const draft = ref('')

function originalOf(edit: Edit) {
  if (edit.kind === 'name') return current.value.name
  if (edit.kind === 'value') return valueById(edit.id)?.name ?? ''
  return ''
}
const dirty = computed(() => editing.value !== null && draft.value.trim() !== originalOf(editing.value))
const isRenaming = (value: OptionValue) => editing.value?.kind === 'value' && editing.value.id === value.id

const unsaved = useModalUnsavedChanges(computed(() => ({ draft: dirty.value ? draft.value : null })), {
  initial: { draft: null },
  close: () => emit('close'),
})

/** An open edit with typed text asks before it's replaced; resolves whether to go on. */
async function confirmDiscard() {
  return !dirty.value || await confirm({ title: 'Discard unsaved changes?', description: 'The text you typed will be lost.', confirmLabel: 'Discard', cancelLabel: 'Keep editing', danger: true })
}

async function startEdit(edit: Edit) {
  if (!await confirmDiscard()) return
  editing.value = edit
  draft.value = originalOf(edit)
}

function stopEdit() {
  editing.value = null
  draft.value = ''
}

const draftError = computed(() => {
  const edit = editing.value
  if (!edit || (edit.kind === 'add' && !draft.value)) return undefined
  return v.safeParse(edit.kind === 'name' ? setNameSchema : valueNameSchema, draft.value).issues?.[0]?.message
})

async function saveEdit() {
  const edit = editing.value
  const name = draft.value.trim()
  if (!edit || draftError.value || !name) return
  if (edit.kind !== 'add' && name === originalOf(edit)) return stopEdit()

  if (edit.kind === 'name') {
    const result = checked(await mutations.rename.execute({ set: current.value, name }))
    if (!result.ok) return
    current.value = result.data
    stopEdit()
  }
  else if (edit.kind === 'value') {
    const value = valueById(edit.id)
    if (!value) return stopEdit()
    const result = checked(await mutations.renameValue.execute({ set: current.value, value, name }))
    if (!result.ok) return
    current.value = result.data
    stopEdit()
  }
  else {
    const result = checked(await mutations.addValue.execute({ set: current.value, name }))
    if (!result.ok) return
    current.value = result.data
    syncOrder()
    // Stays open for the next value, until the set is full.
    if (full.value) stopEdit()
    else draft.value = ''
  }
}

// --- Other changes ---
async function archiveValue(value: OptionValue) {
  const result = checked(await mutations.archiveValue.execute({ set: current.value, value }))
  if (!result.ok) return
  current.value = result.data
  syncOrder()
}

async function restoreValue(value: OptionValue) {
  const result = checked(await mutations.restoreValue.execute({ set: current.value, value }))
  if (!result.ok) return
  current.value = result.data
  syncOrder()
}

async function archiveSet() {
  const result = checked(await mutations.archive.execute({ set: current.value }))
  if (!result.ok) return
  current.value = result.data
  stopEdit()
}

async function restoreSet() {
  const result = checked(await mutations.restore.execute({ set: current.value }))
  if (result.ok) current.value = result.data
}

const LAST_VALUE = 'An option set needs at least one active value.'

function valueActions(value: OptionValue): DropdownMenuItem[] {
  if (archived.value) return []
  const last = active.value.length <= 1
  return [
    { label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => startEdit({ kind: 'value', id: value.id }) },
    { label: 'Archive', icon: 'i-lucide-archive', disabled: last, description: last ? LAST_VALUE : undefined, onSelect: () => archiveValue(value) },
  ]
}

const showArchived = ref(false)

// --- Order: saved shortly after the last move ---
const mode = ref<'browse' | 'reorder'>('browse')
const order = ref<string[]>(active.value.map(value => value.id))
const rows = computed(() => order.value.map(id => valueById(id)).filter((value): value is OptionValue => value?.status === 'active'))
function syncOrder() {
  order.value = activeValues(current.value).map(value => value.id)
}

let reorderFailed = false
const autosave = createOrderAutosave({
  delay: 500,
  save: async (valueIds) => {
    const result = checked(await mutations.reorderValues.execute({ set: current.value, valueIds }))
    if (result.ok) current.value = result.data
    return result.ok
  },
  onFailed: () => {
    reorderFailed = true
    syncOrder()
  },
  onChange: (pending) => {
    reorderPending.value = pending
  },
})
// Closing during the short wait still saves (mutations outlive the editor).
onBeforeUnmount(() => void autosave.flush())

const listEl = useTemplateRef<HTMLElement>('listEl')
const reorderButton = useTemplateRef<{ $el: HTMLElement }>('reorderButton')

async function startReorder() {
  if (!await confirmDiscard()) return
  stopEdit()
  lastError.value = null
  syncOrder()
  mode.value = 'reorder'
  await nextTick()
  listEl.value?.querySelector<HTMLElement>('[data-value-handle]')?.focus()
}

async function finishReorder() {
  reorderFailed = false
  await autosave.flush()
  if (reorderFailed) return
  mode.value = 'browse'
  await nextTick()
  reorderButton.value?.$el?.focus()
}

// "Large moved to position 3" for screen readers, and a moment of highlight for everyone.
const announcement = ref('')
const highlighted = ref<string | null>(null)
let highlightTimer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(highlightTimer))

async function moveValue(index: number, to: number, focus?: 'up' | 'down' | 'handle') {
  const id = order.value[index]
  if (!id || to < 0 || to >= order.value.length || to === index) return
  order.value = moveEntry(order.value, index, to)
  autosave.schedule(order.value)

  announcement.value = ''
  await nextTick()
  announcement.value = `${valueById(id)?.name} moved to position ${to + 1}`
  highlighted.value = id
  clearTimeout(highlightTimer)
  highlightTimer = setTimeout(() => (highlighted.value = null), 1500)

  if (!focus) return
  // Focus stays on the moved row: the pressed button, or at either end the one still enabled.
  const row = listEl.value?.querySelector<HTMLElement>(`[data-value="${id}"]`)
  const pressed = focus === 'handle' ? '[data-value-handle]' : `[data-move=${focus}]`
  const target = row?.querySelector<HTMLElement>(`${pressed}:not(:disabled)`)
    ?? row?.querySelector<HTMLElement>('[data-move]:not(:disabled)')
    ?? row?.querySelector<HTMLElement>('[data-value-handle]')
  target?.focus()
}

function onHandleKey(event: KeyboardEvent, index: number) {
  const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : undefined
  if (to === undefined) return
  event.preventDefault()
  moveValue(index, to, 'handle')
}

// Sortable moves the DOM row; put it back and move the data instead, so Vue owns the rows.
const sortable = useSortable(listEl, [], {
  handle: '[data-value-handle]',
  animation: 150,
  // The slide-over renders its body after this component mounts.
  watchElement: true,
  onUpdate: (event) => {
    removeNode(event.item)
    insertNodeAt(event.from, event.item, event.oldIndex!)
    moveValue(event.oldIndex!, event.newIndex!)
  },
})
watchEffect(() => sortable.option('disabled', mode.value !== 'reorder' || archived.value))

/**
 * Escape in reorder mode finishes reordering instead of closing the editor. (Inside an inline edit
 * the input handles Escape and prevents its default, which already keeps the slide-over open.)
 */
function onEscape(event: KeyboardEvent) {
  if (mode.value === 'reorder') {
    event.preventDefault()
    finishReorder()
  }
}
</script>

<template>
  <USlideover
    :title="current.name"
    :content="{ onEscapeKeyDown: onEscape }"
    :ui="{ footer: 'pb-[max(env(safe-area-inset-bottom),1rem)] sm:hidden' }"
    @update:open="unsaved.onOpenChange"
  >
    <template #title>
      <span class="flex flex-wrap items-center gap-2 pr-10">
        <span class="min-w-0 break-words">{{ current.name }}</span>
        <UBadge
          :label="archived ? 'Archived' : 'Active'"
          :color="archived ? 'neutral' : 'success'"
          variant="subtle"
          size="sm"
        />
      </span>
    </template>
    <template #description>
      <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>{{ usageLabel(current.itemCount) }}</span>
        <span aria-hidden="true">·</span>
        <span
          role="status"
          class="inline-flex items-center gap-1"
          :class="status === 'error' && 'text-error'"
        >
          <template v-if="status === 'saving'">
            <UIcon
              name="i-lucide-loader-circle"
              class="size-3.5 animate-spin"
            />Saving…
          </template>
          <template v-else-if="status === 'saved'">
            <UIcon
              name="i-lucide-check"
              class="size-3.5 text-success"
            />Saved
          </template>
          <template v-else-if="status === 'error'">
            <UIcon
              name="i-lucide-circle-alert"
              class="size-3.5"
            />Couldn't save
          </template>
          <template v-else>Changes save automatically</template>
        </span>
      </span>
    </template>

    <template #body>
      <div class="space-y-6">
        <UAlert
          v-if="archived"
          icon="i-lucide-archive"
          color="neutral"
          variant="subtle"
          description="This option set is archived. Existing menu items keep it, but it cannot be added to other items."
          :actions="[{ label: 'Restore option set', icon: 'i-lucide-archive-restore', color: 'primary', variant: 'solid', loading: busy, onClick: restoreSet }]"
        />

        <!-- Name -->
        <section
          v-if="mode === 'browse'"
          aria-label="Name"
        >
          <h3 class="mb-2 font-semibold text-highlighted">
            Name
          </h3>
          <OptionInlineEdit
            v-if="editing?.kind === 'name'"
            v-model="draft"
            label="Option set name"
            :error="draftError"
            :saving="busy"
            @save="saveEdit"
            @cancel="stopEdit"
          />
          <div
            v-else
            class="flex items-center justify-between gap-3"
          >
            <span class="min-w-0 break-words">{{ current.name }}</span>
            <UButton
              v-if="!archived"
              label="Edit"
              icon="i-lucide-pencil"
              color="neutral"
              variant="ghost"
              aria-label="Edit name"
              @click="startEdit({ kind: 'name' })"
            />
          </div>
        </section>

        <div
          v-if="lastError"
          ref="errorEl"
        >
          <UAlert
            :color="lastError.conflict ? 'warning' : 'error'"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :title="lastError.conflict ? 'Someone else changed this option set' : 'That change wasn\'t saved'"
            :description="lastError.conflict ? 'Reload it to see their changes, then try again.' : lastError.message"
            :actions="lastError.conflict ? [{ label: 'Reload', icon: 'i-lucide-refresh-cw', color: 'neutral', variant: 'outline', onClick: reload }] : []"
          />
        </div>

        <!-- Values -->
        <section
          aria-labelledby="option-values-heading"
          class="space-y-3"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h3
                id="option-values-heading"
                class="flex flex-wrap items-center gap-2 font-semibold text-highlighted"
              >
                {{ mode === 'reorder' ? 'Reorder values' : 'Values' }}
                <UBadge
                  :label="`${active.length} of ${MAX_OPTION_VALUES}`"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                />
              </h3>
              <p class="text-sm text-muted">
                {{ mode === 'reorder' ? 'Drag values or use the arrow buttons. Every move saves automatically.' : 'Customer-facing order' }}
              </p>
            </div>
            <UButton
              v-if="mode === 'reorder'"
              label="Done reordering"
              icon="i-lucide-check"
              :loading="reorderPending"
              class="hidden sm:inline-flex"
              @click="finishReorder()"
            />
            <UButton
              v-else-if="!archived"
              ref="reorderButton"
              label="Reorder"
              icon="i-lucide-arrow-down-up"
              color="neutral"
              variant="outline"
              class="shrink-0"
              :disabled="active.length < 2 || busy"
              @click="startReorder()"
            />
          </div>

          <ol
            ref="listEl"
            aria-labelledby="option-values-heading"
            class="space-y-2"
          >
            <OptionValueRow
              v-for="(value, i) in rows"
              :key="value.id"
              :value="value"
              :position="i + 1"
              :mode="mode"
              :actions="valueActions(value)"
              :renaming="isRenaming(value)"
              :can-move-up="i > 0"
              :can-move-down="i < rows.length - 1"
              :highlighted="highlighted === value.id"
              @move="by => moveValue(i, i + by, by < 0 ? 'up' : 'down')"
              @handle-keydown="onHandleKey($event, i)"
            >
              <OptionInlineEdit
                v-model="draft"
                :label="`Name of ${value.name}`"
                :error="draftError"
                :saving="busy"
                @save="saveEdit"
                @cancel="stopEdit"
              />
            </OptionValueRow>
          </ol>
          <p
            aria-live="polite"
            class="sr-only"
          >
            {{ announcement }}
          </p>

          <template v-if="mode === 'browse' && !archived">
            <OptionInlineEdit
              v-if="editing?.kind === 'add'"
              v-model="draft"
              label="New value"
              save-label="Add"
              placeholder="e.g. Extra large"
              :error="draftError"
              :saving="busy"
              @save="saveEdit"
              @cancel="stopEdit"
            />
            <template v-else>
              <UButton
                label="Add value"
                icon="i-lucide-plus"
                variant="soft"
                block
                :disabled="full"
                @click="startEdit({ kind: 'add' })"
              />
              <p
                v-if="full"
                class="text-sm text-muted"
              >
                A set can have at most {{ MAX_OPTION_VALUES }} active values. Archive one to add another.
              </p>
            </template>
          </template>
        </section>

        <!-- Archived values -->
        <UCollapsible
          v-if="hidden.length && mode === 'browse'"
          v-model:open="showArchived"
        >
          <UButton
            :label="`Archived values (${hidden.length})`"
            color="neutral"
            variant="ghost"
            trailing-icon="i-lucide-chevron-down"
            block
            :ui="{ trailingIcon: 'ms-auto group-data-[state=open]:rotate-180 transition-transform duration-200' }"
            class="group"
          />
          <template #content>
            <div class="space-y-2 pt-2">
              <p class="text-sm text-muted">
                Menu-item versions that use them are hidden until they're restored.
              </p>
              <p
                v-if="full && !archived"
                class="text-sm text-muted"
              >
                A set can have at most {{ MAX_OPTION_VALUES }} active values: archive one to restore another.
              </p>
              <ul class="divide-y divide-default">
                <li
                  v-for="value in hidden"
                  :key="value.id"
                  :aria-label="value.name"
                  class="flex items-center justify-between gap-2 py-2"
                >
                  <span class="min-w-0 break-words text-muted">{{ value.name }}</span>
                  <UButton
                    v-if="!archived"
                    label="Restore"
                    icon="i-lucide-archive-restore"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    :disabled="busy || full"
                    :aria-label="`Restore ${value.name}`"
                    @click="restoreValue(value)"
                  />
                </li>
              </ul>
            </div>
          </template>
        </UCollapsible>

        <!-- Danger zone -->
        <USeparator v-if="!archived && mode === 'browse'" />
        <section
          v-if="!archived && mode === 'browse'"
          aria-labelledby="option-danger-heading"
          class="space-y-2"
        >
          <h3
            id="option-danger-heading"
            class="font-semibold text-highlighted"
          >
            Danger zone
          </h3>
          <p class="text-sm text-muted">
            Existing menu items keep this set, but it cannot be added to other items until restored.
          </p>
          <UButton
            label="Archive option set"
            icon="i-lucide-archive"
            color="error"
            variant="soft"
            :disabled="busy"
            @click="archiveSet()"
          />
        </section>
      </div>
    </template>

    <template
      v-if="mode === 'reorder'"
      #footer
    >
      <UButton
        label="Done reordering"
        icon="i-lucide-check"
        block
        :loading="reorderPending"
        @click="finishReorder()"
      />
    </template>
  </USlideover>
</template>
