<script setup lang="ts">
/**
 * One add-on group on its own page, `/admin/add-ons/:id` (D75): a wide Add-ons column (the add-ons with
 * price and Preselected, search, Add / Edit in a dialog, the ⋮ actions, Reorder mode, archived
 * add-ons, and which menu items use the group) and a Settings column (name and selection rules).
 * On phones the two columns are the tabs "Add-ons" and "Settings".
 *
 * Saving (owner, 2026-09-28): the settings are a draft saved by **Save changes** in one PATCH; every
 * add-on change is its own confirmed action (the dialog's Save, ticking Preselected, Archive,
 * Restore, Save order), each one call. So nothing is ever half-saved. Every answer is the whole
 * group; the page takes it as the truth and sends its version next.
 *
 * Unsaved settings or a pending order are guarded when leaving the page.
 */
import type { Modifier, ModifierGroup } from '#shared/contracts/menu-modifiers'
import { MAX_MODIFIERS } from '#shared/contracts/menu-modifiers'
import type { AddOnAction } from './AddOnActions.vue'
import { activeModifiers, archivedModifiers, useModifierGroup, useModifierGroupMutations } from '../composables/useModifierGroups'
import { describeRules } from '../schemas/modifier-group-display'
import type { GroupSettingsForm, SettingsIssues } from '../schemas/modifier-group-form'
import { archiveAddOnProblem, preselectProblem, settingsIssues, toSettingsChanges, toSettingsForm } from '../schemas/modifier-group-form'
import AddOnFormModal from './AddOnFormModal.vue'
import AddOnReorderList from './AddOnReorderList.vue'
import AddOnRow from './AddOnRow.vue'
import ModifierGroupSettings from './ModifierGroupSettings.vue'
import ModifierGroupUsage from './ModifierGroupUsage.vue'

const tenantPath = useTenantPath()

const props = defineProps<{ id: string }>()

const { data: group, loading, error, refresh } = useModifierGroup(props.id)
const mutations = useModifierGroupMutations()
const busy = computed(() => mutations.isBusy(props.id))
const archived = computed(() => group.value?.status === 'archived')
const active = computed(() => (group.value ? activeModifiers(group.value) : []))
const hidden = computed(() => (group.value ? archivedModifiers(group.value) : []))
const full = computed(() => active.value.length >= MAX_MODIFIERS)
const notFound = computed(() => error.value?.status === 404)

/** Take the server's answer as the truth. */
function take(next: ModifierGroup) {
  group.value = next
}

// --- The last error, shown on the page (conflicts offer Reload) ---
const lastError = ref<{ message: string, conflict: boolean } | null>(null)
function checked<T extends { ok: boolean, status?: string, error?: { code?: string, message: string } }>(result: T): T {
  if (result.ok) lastError.value = null
  else if (result.status === 'error' && result.error) lastError.value = { message: result.error.message, conflict: result.error.code === 'VERSION_CONFLICT' }
  return result
}

async function reload() {
  await refresh()
  lastError.value = null
  resetSettings()
  if (mode.value === 'reorder') order.value = active.value.map(m => m.id)
}

// --- Settings: a draft saved with one PATCH ---
type SettingsSnapshot = Pick<ModifierGroup, 'name' | 'minSelect' | 'maxSelect'>
const settings = ref<GroupSettingsForm>({ name: '', required: false, minSelect: 1, maxSelect: null })
/** The group's settings when the draft started: someone else changing them is a conflict. */
const settingsBase = ref<SettingsSnapshot>()
const snapshot = (g: ModifierGroup): SettingsSnapshot => ({ name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect })
const sameSnapshot = (a?: SettingsSnapshot, b?: SettingsSnapshot) => JSON.stringify(a) === JSON.stringify(b)

const saving = ref(false)
const saveTried = ref(false)
const serverIssues = ref<SettingsIssues>({})
const settingsDirty = computed(() => !!group.value && !!settingsBase.value && toSettingsChanges(settings.value, { ...group.value, ...settingsBase.value }) !== undefined)

function resetSettings() {
  if (!group.value) return
  settings.value = toSettingsForm(group.value)
  settingsBase.value = snapshot(group.value)
  saveTried.value = false
  serverIssues.value = {}
}
// A new answer (ours or a refresh) resets a clean draft; an edited draft is kept.
watch(group, () => {
  if (!settingsDirty.value) resetSettings()
}, { immediate: true })

watch(() => settings.value.name, () => (serverIssues.value.name = undefined))
const checkIssues = computed(() => settingsIssues(settings.value, { active: active.value.length, defaults: active.value.filter(m => m.isDefault).length }))
const shownIssues = computed<SettingsIssues>(() => ({ ...(settingsDirty.value || saveTried.value ? checkIssues.value : {}), ...Object.fromEntries(Object.entries(serverIssues.value).filter(([, v]) => v)) }))

async function saveSettings() {
  const current = group.value
  if (!current || saving.value || !settingsDirty.value) return
  saveTried.value = true
  if (Object.keys(checkIssues.value).length) return
  if (!sameSnapshot(settingsBase.value, snapshot(current))) {
    lastError.value = { message: 'Someone else changed these settings.', conflict: true }
    return
  }
  const changes = toSettingsChanges(settings.value, current)
  if (!changes) return
  saving.value = true
  const result = checked(await mutations.update.execute({ group: current, changes }))
  saving.value = false
  if (result.ok) {
    take(result.data)
    resetSettings()
  }
  else if (result.status === 'error') {
    const fields = result.error.fieldErrors ?? {}
    serverIssues.value = { name: fields.name?.[0], minSelect: fields.minSelect?.[0], maxSelect: fields.maxSelect?.[0] ?? fields.modifiers?.[0] }
  }
}

// --- Add-ons ---
const overlay = useOverlay()
const addOnModal = overlay.create(AddOnFormModal)

async function openAddOn(modifier?: Modifier) {
  if (!group.value) return
  const saved = await addOnModal.open({ group: group.value, modifier }).result
  if (saved) {
    lastError.value = null
    take(saved)
  }
}

async function toggleDefault(modifier: Modifier, isDefault: boolean) {
  if (!group.value) return
  const result = checked(await mutations.updateModifier.execute({ group: group.value, modifier, fields: { isDefault } }))
  if (result.ok) take(result.data)
}

async function archiveAddOn(modifier: Modifier) {
  if (!group.value) return
  const result = checked(await mutations.archiveModifier.execute({ group: group.value, modifier }))
  if (result.ok) take(result.data)
}

async function restoreAddOn(modifier: Modifier) {
  if (!group.value) return
  const result = checked(await mutations.restoreModifier.execute({ group: group.value, modifier }))
  if (result.ok) take(result.data)
}

async function archiveGroup() {
  if (!group.value) return
  const result = checked(await mutations.archive.execute({ group: group.value }))
  if (result.ok) take(result.data)
}

async function restoreGroup() {
  if (!group.value) return
  const result = checked(await mutations.restore.execute({ group: group.value }))
  if (result.ok) take(result.data)
}

function addOnActions(modifier: Modifier): AddOnAction[] {
  if (!group.value) return []
  const cantArchive = archiveAddOnProblem(group.value, modifier)
  const cantPreselect = modifier.isDefault ? undefined : preselectProblem(group.value, modifier)
  return [
    { label: 'Edit add-on', icon: 'i-lucide-pencil', onSelect: () => openAddOn(modifier) },
    modifier.isDefault
      ? { label: 'Remove preselection', icon: 'i-lucide-circle-x', onSelect: () => toggleDefault(modifier, false) }
      : { label: 'Set as preselected', icon: 'i-lucide-circle-check', disabled: !!cantPreselect, description: cantPreselect, onSelect: () => toggleDefault(modifier, true) },
    { label: 'Archive add-on', icon: 'i-lucide-archive', color: 'error', disabled: !!cantArchive, description: cantArchive, onSelect: () => archiveAddOn(modifier) },
  ]
}

const addOnSearch = ref('')
const shownAddOns = computed(() => {
  const term = addOnSearch.value.trim().toLowerCase()
  return term ? active.value.filter(m => m.name.toLowerCase().includes(term)) : active.value
})
const showArchived = ref(false)

// --- Reorder mode: moves are pending until Save order (one request) ---
const mode = ref<'browse' | 'reorder'>('browse')
const order = ref<string[]>([])
const orderRows = computed(() => order.value.map(id => active.value.find(m => m.id === id)).filter((m): m is Modifier => !!m))
const orderDirty = computed(() => mode.value === 'reorder' && order.value.join() !== active.value.map(m => m.id).join())
const savingOrder = ref(false)
const reorderEl = useTemplateRef<HTMLElement>('reorderEl')

async function startReorder() {
  addOnSearch.value = ''
  lastError.value = null
  order.value = active.value.map(m => m.id)
  mode.value = 'reorder'
  await nextTick()
  reorderEl.value?.querySelector<HTMLElement>('[data-handle]')?.focus()
}

function moveAddOn(from: number, to: number) {
  const next = [...order.value]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  order.value = next
}

function cancelReorder() {
  lastError.value = null
  mode.value = 'browse'
}

async function saveOrder() {
  if (!group.value || savingOrder.value) return
  if (!orderDirty.value) return cancelReorder()
  savingOrder.value = true
  const result = checked(await mutations.reorderModifiers.execute({ group: group.value, modifierIds: [...order.value] }))
  savingOrder.value = false
  // A refused order stays on screen (still in reorder mode) to save again, or Reload after a conflict.
  if (!result.ok) return
  take(result.data)
  mode.value = 'browse'
}

// --- Leaving with unsaved settings or order asks first ---
useUnsavedChanges(
  computed(() => ({ settings: settingsDirty.value ? settings.value : null, order: orderDirty.value ? order.value : null })),
  { initial: { settings: null, order: null }, paused: computed(() => saving.value || savingOrder.value) },
)

// --- Phones: Add-ons and Settings are tabs ---
const tab = useUrlTab(['addons', 'settings'] as const)
const tabsRow = useTemplateRef('tabsRow')
useCenteredTab(tabsRow, () => tab.value)
const tabs = computed(() => [
  { label: 'Add-ons', value: 'addons', badge: { label: String(active.value.length), color: 'neutral' as const, variant: 'subtle' as const, size: 'sm' as const } },
  { label: 'Settings', value: 'settings' },
])

const headerActions = computed(() => archived.value
  ? [{ label: 'Restore group', icon: 'i-lucide-archive-restore', onSelect: restoreGroup }]
  : [{ label: 'Archive group', icon: 'i-lucide-archive', color: 'error' as const, onSelect: archiveGroup }])
</script>

<template>
  <UDashboardPanel id="modifier-group">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            :to="tenantPath('/admin/add-ons')"
            aria-label="Back to Add-ons"
            class="lg:hidden"
          />
        </template>
        <template #title>
          <UBreadcrumb
            :items="[{ label: 'Add-ons', to: tenantPath('/admin/add-ons') }, { label: group?.name ?? 'Add-on group' }]"
            class="hidden min-w-0 lg:flex"
          />
          <span class="truncate lg:hidden">{{ group?.name ?? 'Add-on group' }}</span>
        </template>
        <template #right>
          <UButton
            v-if="group && !archived"
            label="Save changes"
            icon="i-lucide-save"
            class="hidden lg:inline-flex"
            :disabled="!settingsDirty || busy"
            :loading="saving"
            @click="saveSettings()"
          />
          <UDropdownMenu
            v-if="group"
            :items="headerActions"
            :content="{ align: 'end' }"
            class="lg:hidden"
          >
            <UButton
              icon="i-lucide-ellipsis-vertical"
              color="neutral"
              variant="ghost"
              aria-label="Group actions"
              class="lg:hidden"
            />
          </UDropdownMenu>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div
        v-if="notFound"
        class="flex flex-col items-center gap-2 py-10 text-center"
      >
        <UIcon
          name="i-lucide-search-x"
          class="size-10 text-dimmed"
        />
        <p class="font-medium text-highlighted">
          This add-on group doesn't exist
        </p>
        <p class="text-sm text-muted">
          It may have been removed, or the link is wrong.
        </p>
        <UButton
          label="Back to Add-ons"
          :to="tenantPath('/admin/add-ons')"
          color="neutral"
          variant="outline"
          class="mt-2"
        />
      </div>

      <ApiErrorAlert
        v-else-if="error"
        :error="error"
        title="Could not load the add-on group"
        @retry="refresh()"
      />

      <ListSkeleton
        v-else-if="loading || !group"
        label="Loading the add-on group…"
      />

      <div
        v-else
        class="space-y-6"
      >
        <!-- Heading -->
        <div
          class="space-y-1"
          :class="mode === 'reorder' && 'max-lg:hidden'"
        >
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="break-words text-xl font-semibold text-highlighted">
              {{ group.name }}
            </h2>
            <UBadge
              :label="archived ? 'Archived' : 'Active'"
              :icon="archived ? 'i-lucide-archive' : 'i-lucide-circle-check'"
              :color="archived ? 'neutral' : 'success'"
              variant="subtle"
            />
          </div>
          <p class="text-sm text-muted">
            {{ describeRules(group.minSelect, group.maxSelect) }}
          </p>
        </div>

        <UAlert
          v-if="archived"
          icon="i-lucide-archive"
          color="neutral"
          variant="subtle"
          title="This add-on group is archived"
          :description="`Menu items that offer it keep it, but it can't be added to other items. Restore it to edit it.`"
          :actions="[{ label: 'Restore group', icon: 'i-lucide-archive-restore', color: 'primary', variant: 'solid', loading: busy, onClick: restoreGroup }]"
        />

        <UAlert
          v-if="lastError"
          :color="lastError.conflict ? 'warning' : 'error'"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="lastError.conflict ? 'Someone else changed this add-on group' : 'That change wasn\'t saved'"
          :description="lastError.conflict ? 'Reload it to see their changes, then try again.' : lastError.message"
          :actions="lastError.conflict ? [{ label: 'Reload', icon: 'i-lucide-refresh-cw', color: 'neutral', variant: 'outline', onClick: reload }] : []"
        />

        <UTabs
          ref="tabsRow"
          v-model="tab"
          :items="tabs"
          :content="false"
          variant="link"
          size="sm"
          :class="['lg:hidden', mode === 'reorder' && 'hidden']"
        />

        <div class="flex flex-col gap-6 lg:flex-row lg:items-start">
          <div
            class="min-w-0 space-y-6 lg:flex-1"
            :class="tab !== 'addons' && 'max-lg:hidden'"
          >
            <UCard
              variant="outline"
              :ui="{ root: 'overflow-visible' }"
            >
              <!-- Browse -->
              <!-- @container: the list lays out by the column's width, not the viewport's (D82) -->
              <section
                v-if="mode === 'browse'"
                aria-labelledby="add-ons-heading"
                class="@container space-y-4"
              >
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2
                      id="add-ons-heading"
                      class="font-semibold text-highlighted"
                    >
                      Add-ons
                    </h2>
                    <p class="text-sm text-muted">
                      {{ pluralize(active.length, ['active add-on', 'active add-ons']) }}
                    </p>
                  </div>
                  <div class="flex w-full flex-wrap items-center gap-2 @md:w-auto">
                    <UInput
                      v-model="addOnSearch"
                      icon="i-lucide-search"
                      placeholder="Search add-ons"
                      aria-label="Search add-ons"
                      class="w-full @md:w-48"
                    />
                    <template v-if="!archived">
                      <UButton
                        label="Reorder"
                        icon="i-lucide-arrow-down-up"
                        color="neutral"
                        variant="outline"
                        class="flex-1 justify-center @md:flex-none"
                        :disabled="active.length < 2 || busy"
                        @click="startReorder()"
                      />
                      <UTooltip
                        :text="`A group can have at most ${MAX_MODIFIERS} active add-ons.`"
                        :disabled="!full"
                      >
                        <UButton
                          label="Add add-on"
                          icon="i-lucide-plus"
                          variant="outline"
                          class="flex-1 justify-center @md:flex-none"
                          :disabled="full || busy"
                          @click="openAddOn()"
                        />
                      </UTooltip>
                    </template>
                  </div>
                </div>

                <!-- Column headings of the wide layout; widths match AddOnRow -->
                <div
                  class="hidden gap-4 border-b border-default pb-2 text-xs font-medium text-muted @md:flex"
                  aria-hidden="true"
                >
                  <span class="min-w-0 flex-1">Add-on</span>
                  <span class="w-24 shrink-0 text-right">Default price</span>
                  <span class="w-36 shrink-0">Preselected</span>
                  <span class="w-12 shrink-0 text-right">Actions</span>
                </div>
                <ul
                  aria-label="Active add-ons"
                  class="divide-y divide-default"
                >
                  <AddOnRow
                    v-for="modifier in shownAddOns"
                    :key="modifier.id"
                    :modifier="modifier"
                    :actions="addOnActions(modifier)"
                    :read-only="archived"
                    :busy="busy"
                    :preselect-blocked="preselectProblem(group, modifier)"
                    @edit="openAddOn(modifier)"
                    @toggle-default="value => toggleDefault(modifier, value)"
                  />
                </ul>
                <div
                  v-if="addOnSearch && !shownAddOns.length"
                  class="flex flex-wrap items-center gap-2 text-sm text-muted"
                >
                  No add-ons match “{{ addOnSearch.trim() }}”.
                  <UButton
                    label="Clear search"
                    variant="link"
                    class="px-0"
                    @click="addOnSearch = ''"
                  />
                </div>
                <p class="flex items-center gap-2 text-sm text-muted">
                  <UIcon
                    name="i-lucide-info"
                    class="size-4 shrink-0"
                  />
                  Default prices can be overridden on individual menu items.
                </p>

                <UCollapsible
                  v-if="hidden.length"
                  v-model:open="showArchived"
                >
                  <UButton
                    :label="`Archived add-ons (${hidden.length})`"
                    color="neutral"
                    variant="ghost"
                    trailing-icon="i-lucide-chevron-down"
                    block
                    :ui="{ trailingIcon: 'ms-auto group-data-[state=open]:rotate-180 motion-safe:transition-transform duration-200' }"
                    class="group"
                  />
                  <template #content>
                    <div class="space-y-2 pt-2">
                      <p class="text-sm text-muted">
                        Customers don't see archived add-ons until they're restored.
                      </p>
                      <p
                        v-if="full && !archived"
                        class="text-sm text-muted"
                      >
                        A group can have at most {{ MAX_MODIFIERS }} active add-ons: archive one to restore another.
                      </p>
                      <ul class="divide-y divide-default">
                        <li
                          v-for="modifier in hidden"
                          :key="modifier.id"
                          :aria-label="modifier.name"
                          class="flex items-center justify-between gap-2 py-2"
                        >
                          <span class="min-w-0 break-words text-muted">{{ modifier.name }}</span>
                          <UButton
                            v-if="!archived"
                            label="Restore"
                            icon="i-lucide-archive-restore"
                            color="neutral"
                            variant="outline"
                            size="sm"
                            :disabled="busy || full"
                            :aria-label="`Restore ${modifier.name}`"
                            @click="restoreAddOn(modifier)"
                          />
                        </li>
                      </ul>
                    </div>
                  </template>
                </UCollapsible>
              </section>

              <!-- Reorder -->
              <section
                v-else
                ref="reorderEl"
                aria-labelledby="reorder-heading"
                class="space-y-4"
              >
                <h2
                  id="reorder-heading"
                  class="font-semibold text-highlighted"
                >
                  Reorder add-ons
                </h2>
                <!-- The mode's actions: at the bottom of the screen below lg, above the list from lg -->
                <BottomActionBar label="Reorder">
                  <p class="min-w-0 flex-1 text-sm text-muted">
                    {{ orderDirty ? 'The new order isn\'t saved yet.' : 'Nothing is saved until Save order.' }}
                  </p>
                  <div class="flex flex-wrap items-center justify-end gap-2">
                    <UButton
                      label="Cancel"
                      color="neutral"
                      variant="outline"
                      :disabled="savingOrder"
                      @click="cancelReorder()"
                    />
                    <UButton
                      label="Save order"
                      icon="i-lucide-save"
                      :loading="savingOrder"
                      @click="saveOrder()"
                    />
                  </div>
                </BottomActionBar>
                <p class="text-sm text-muted">
                  Drag an add-on or use its arrows. Customers see them in this order.
                </p>
                <AddOnReorderList
                  :modifiers="orderRows"
                  :disabled="savingOrder"
                  @move="moveAddOn"
                />
              </section>
            </UCard>

            <UCard
              v-if="mode === 'browse'"
              variant="outline"
            >
              <ModifierGroupUsage :group="group" />
            </UCard>
          </div>

          <UCard
            variant="outline"
            class="lg:w-88 lg:shrink-0"
            :class="[tab !== 'settings' && 'max-lg:hidden', mode === 'reorder' && 'max-lg:hidden']"
          >
            <ModifierGroupSettings
              v-model="settings"
              :group="group"
              :issues="shownIssues"
              :read-only="archived || saving"
              :busy="busy"
              @archive="archiveGroup()"
              @restore="restoreGroup()"
            />
          </UCard>
        </div>
      </div>

      <!-- Below lg: Save changes at hand while the settings have changes (from lg it's in the navbar) -->
      <BottomActionBar
        v-if="group && settingsDirty && !archived"
        label="Settings actions"
        expanded="hidden"
      >
        <UButton
          label="Save changes"
          icon="i-lucide-save"
          block
          :loading="saving"
          :disabled="busy"
          @click="saveSettings()"
        />
      </BottomActionBar>
    </template>
  </UDashboardPanel>
</template>
