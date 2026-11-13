import * as v from 'valibot'
import { layoutSchema, NO_SCENE } from '#shared/contracts/shop-layout'
import type { BranchLayout, ItemLook, LayoutItem, LayoutTable, Placement, ScenePreset, ShopLayout, TableLook } from '#shared/contracts/shop-layout'
import { BUILT_IN_LOOKS, NEW_TABLE_LOOK } from '../designer/catalog'
import { copySelected } from '../designer/group'
import type { PlanClipboard } from '../designer/group'
import type { PlanSelection } from '../designer/plan'
import { fetchBranchLayout, useBranchLayout, useItemLooks, useLayoutMutations, useLooks } from './useBranches'
import { useLayoutDraft } from './useLayoutDraft'
import type { LayoutDraft } from './useLayoutDraft'

/**
 * A branch's shop layout being edited (D273, step 2b): the saved layout from the server, the draft
 * on top of it, and the version the draft started from.
 *
 * - **Saved vs draft.** With nothing unsaved, the draft follows the server (a refetch after a table
 *   change, or another device's save seen on return). A refetch that brings the same drawing
 *   keeps the selection and the undo history. With unsaved changes it is kept, and its
 *   save names the version it started from.
 * - **A stale save (409 `VERSION_CONFLICT`)** keeps the draft and offers the choice (frame 6A):
 *   `loadLatest` puts the latest layout in place as one undo step, so undo brings the draft back
 *   on top of it; `overwrite` asks first, then saves the draft at the latest version.
 * - **A placed table that is no longer active** (archived or deleted elsewhere) is listed in
 *   `unavailable`; the server refuses the save while it is placed (409
 *   `LAYOUT_TABLE_UNAVAILABLE`), and `removeUnavailable` takes it off the map.
 * - **Looks** are the built-in ones and the cafe's own (step 3a), loaded with the layout. A placed
 *   table whose look is neither (deleted elsewhere while this draft used it) is listed in
 *   `unknownLooks`; the server refuses the save (409 `LAYOUT_LOOK_UNAVAILABLE`), and
 *   `resetUnknownLooks` gives those tables the default look. The same for a piece of furniture
 *   whose chair or fixture look is gone (step 3d, `unknownItemLooks`): it goes back to its own
 *   finishes.
 * - **The scene** (step 4a, the surroundings in 3D) is part of the draft: choosing one is a change
 *   like moving a table, undone the same way, saved with the layout by Save layout, at its version.
 * - **Leaving with unsaved changes asks first** (`useUnsavedChanges`, the app's guard); Discard
 *   puts the saved layout back.
 *
 * Owned by the branch page, so switching between Table list, Design shop and View in 3D keeps it.
 * Leaving the page drops it, and changing cafes is a full page load. Nothing loads until `load()`
 * (the first time Design shop or View in 3D opens): the table list doesn't need the layout.
 */

/** Autosave (ISS-027): this long after the last change, and never longer behind while edits keep coming. */
export const AUTOSAVE_DELAY_MS = 2_000
export const AUTOSAVE_MAX_WAIT_MS = 10_000

export interface LayoutConflict {
  /** The layout as saved now; `null` while it loads or when it couldn't be read. */
  latest: BranchLayout | null
}

export function useLayoutEditor(branchId: string) {
  const query = useBranchLayout(branchId, { immediate: false })
  const looksQuery = useLooks({ immediate: false })
  const itemLooksQuery = useItemLooks({ immediate: false })
  const { save: saveMutation } = useLayoutMutations()
  const confirm = useConfirm()
  const draft: LayoutDraft = useLayoutDraft({ floors: [], placements: [], scene: NO_SCENE })

  /** The version the draft started from; 0 until the branch's first save. */
  const version = ref(0)
  /** The server's layout the draft is based on: the same object again is not news. */
  let applied: BranchLayout | null = null
  const conflict = shallowRef<LayoutConflict | null>(null)
  /** Why the draft can't be saved as it is, found before sending it (a floor without an outline). */
  const problem = ref<string | null>(null)
  const saving = ref(false)

  const floorId = ref<string | null>(null)
  const selection = ref<PlanSelection | null>(null)
  /**
   * Several pieces selected together (D278: Shift+click, a box drag, Ctrl/⌘+A): the whole set,
   * `selection` being the one last picked (Properties' and 3D's). Empty for one or none. Setting
   * `selection` to anything outside the set (a click, a floor change, a 3D pick) ends the set.
   */
  const group = ref<PlanSelection[]>([])
  const inGroup = (target: PlanSelection | null) => !!target && group.value.some(member => member.kind === target.kind && member.id === target.id)
  watch(selection, (current) => {
    if (group.value.length && !inGroup(current)) group.value = []
  }, { flush: 'sync' })
  /** Everything selected: the set, or the one selection, or nothing. */
  const selected = computed<PlanSelection[]>(() => (group.value.length ? group.value : selection.value ? [selection.value] : []))
  /**
   * Ctrl/⌘+C (ISS-022): a copy of what was selected, in memory only, dropped with the editor
   * (leaving the page; changing cafes is a full page load). Each paste lands 50 cm further on.
   */
  const clipboard = shallowRef<PlanClipboard | null>(null)
  let pastes = 0
  function copy(): boolean {
    const id = floorId.value
    const copied = id ? copySelected(draft.layout.value, id, selected.value) : null
    if (!copied) return false
    clipboard.value = copied
    pastes = 0
    return true
  }
  function nextPasteOffset() {
    pastes += 1
    return { x: 50 * pastes, y: 50 * pastes }
  }
  /** Selects these together (one of them becomes `selection`); one or none is a plain selection. */
  function selectMany(targets: readonly PlanSelection[]) {
    const unique = targets.filter((target, index) => targets.findIndex(other => other.kind === target.kind && other.id === target.id) === index)
    if (unique.length <= 1) {
      group.value = []
      selection.value = unique[0] ?? null
      return
    }
    group.value = unique.map(target => ({ ...target }))
    selection.value = { ...unique.at(-1)! }
  }

  const state = computed(() => draft.layout.value)
  const unsaved = useUnsavedChanges(state, { onDiscard: () => applied && start(applied) })

  const tables = computed<readonly LayoutTable[]>(() => query.data.value?.tables ?? [])
  const unavailable = computed<Placement[]>(() => {
    if (!query.data.value) return []
    const active = new Set(tables.value.map(table => table.id))
    return draft.layout.value.placements.filter(placement => !active.has(placement.tableId))
  })

  /** The built-in looks, then the cafe's own by name. */
  const looks = computed<readonly TableLook[]>(() => [...BUILT_IN_LOOKS, ...(looksQuery.data.value ?? [])])
  const unknownLooks = computed<Placement[]>(() => {
    if (!looksQuery.data.value) return []
    const known = new Set(looks.value.map(look => look.id))
    return draft.layout.value.placements.filter(placement => !known.has(placement.lookId))
  })
  /** The cafe's chair and fixture looks by name (step 3d). */
  const itemLooks = computed<readonly ItemLook[]>(() => itemLooksQuery.data.value ?? [])
  /** Pieces whose look is no longer one of the cafe's of their kind (deleted elsewhere under this draft). */
  const unknownItemLooks = computed<LayoutItem[]>(() => {
    if (!itemLooksQuery.data.value) return []
    const kinds = new Map(itemLooks.value.map(look => [look.id, look.kind]))
    return draft.layout.value.floors.flatMap(floor => floor.items.filter(item => item.lookId !== undefined && kinds.get(item.lookId) !== item.kind))
  })
  const sources = [query, looksQuery, itemLooksQuery]
  /** The layout and the looks are all here: the editor and the 3D view draw only then. */
  const ready = computed(() => sources.every(source => !!source.data.value))
  const error = computed(() => sources.map(source => (source.data.value ? null : source.error.value)).find(Boolean) ?? null)

  function start(layout: BranchLayout) {
    applied = layout
    version.value = layout.version
    draft.reset({ floors: cloneFormValue(layout.floors), placements: cloneFormValue(layout.placements), scene: cloneFormValue(layout.scene), ...(layout.pages && { pages: cloneFormValue(layout.pages) }) })
    unsaved.markClean(draft.layout.value)
    conflict.value = null
    problem.value = null
    if (!draft.layout.value.floors.some(floor => floor.id === floorId.value)) floorId.value = draft.layout.value.floors[0]?.id ?? null
    selection.value = null
  }

  watch(query.data, (layout) => {
    if (!layout || layout === applied || unsaved.isDirty.value) return
    // The same drawing and scene again (a refetch after a table or a look changed): the selection
    // and the undo history stay. Only its tables are news, and those are read from the query.
    const { floors, placements, scene, pages } = draft.layout.value
    if (applied && isSameFormValue(layout.floors, floors) && isSameFormValue(layout.placements, placements) && isSameFormValue(layout.scene, scene) && isSameFormValue(layout.pages ?? null, pages ?? null)) {
      applied = layout
      version.value = layout.version
      return
    }
    start(layout)
  }, { immediate: true })

  /** Sends the draft at `at` (the version read, or the latest one when overwriting); `quiet` for an autosave. */
  async function send(at: number, quiet = false): Promise<boolean> {
    if (saving.value) return false
    const parsed = v.safeParse(layoutSchema, draft.layout.value)
    if (!parsed.success) {
      problem.value = describeIssue(parsed.issues[0], draft.layout.value)
      return false
    }
    problem.value = null
    const sent = draft.layout.value
    saving.value = true
    const result = await saveMutation.execute({ branchId, body: { version: at, layout: parsed.output }, quiet })
    saving.value = false
    if (result.ok) {
      applied = result.data
      version.value = result.data.version
      conflict.value = null
      // What was sent is saved; anything changed while it was on its way is still unsaved.
      unsaved.markClean(sent)
      query.data.value = result.data
      // Which looks the saved tables and pieces use changed with it (a look in use can't be deleted).
      if (looksQuery.data.value?.length) void looksQuery.refresh()
      if (itemLooksQuery.data.value?.length) void itemLooksQuery.refresh()
      // Changed while it was on its way: those changes save next.
      if (unsaved.isDirty.value) scheduleAutosave()
      return true
    }
    if (result.status !== 'error') return false
    if (result.error.code === 'VERSION_CONFLICT') {
      conflict.value = { latest: null }
      const latest = await fetchBranchLayout(branchId).catch(() => null)
      if (conflict.value) conflict.value = { latest }
    }
    // A placed table left the branch: refetch its tables, so the editor names it.
    if (result.error.code === 'LAYOUT_TABLE_UNAVAILABLE') void query.refresh()
    // A look was deleted: refetch the looks, so the editor names the tables and pieces that used it.
    if (result.error.code === 'LAYOUT_LOOK_UNAVAILABLE') {
      void looksQuery.refresh()
      void itemLooksQuery.refresh()
    }
    return false
  }

  /** Loads the layout and the looks the first time they're needed. */
  function load() {
    for (const source of sources) {
      if (source.status.value === 'idle') void source.execute()
    }
  }

  /** Loads again whichever of them failed. */
  function retry() {
    for (const source of sources) {
      if (!source.data.value) void source.refresh()
    }
  }

  function save() {
    cancelAutosave()
    return send(version.value)
  }

  // --- Autosave (ISS-027, owner: like Figma) ---
  // The layout saves itself a moment after the last change, through the same checked save (the
  // version read, 409 on a stale one, one batch). It waits while a save is on its way, and stops
  // while a conflict or a problem is shown: the next change, or the user's choice there, goes on.
  // Save layout still saves at once. The editor ends with the page, and the timer with it.
  let timer: ReturnType<typeof setTimeout> | undefined
  let pendingSince = 0
  function cancelAutosave() {
    clearTimeout(timer)
    timer = undefined
    pendingSince = 0
  }
  function scheduleAutosave() {
    clearTimeout(timer)
    const now = Date.now()
    pendingSince ||= now
    // Never more than AUTOSAVE_MAX_WAIT_MS behind while edits keep coming.
    const wait = Math.max(0, Math.min(AUTOSAVE_DELAY_MS, pendingSince + AUTOSAVE_MAX_WAIT_MS - now))
    timer = setTimeout(() => void autosave(), wait)
  }
  async function autosave() {
    cancelAutosave()
    if (!ready.value || !unsaved.isDirty.value || conflict.value || saving.value) return
    await send(version.value, true)
  }
  watch(() => draft.layout.value, () => {
    if (unsaved.isDirty.value) scheduleAutosave()
  })
  onScopeDispose(cancelAutosave)

  /**
   * A version from the history (ISS-027) in place of the draft, as one undo step: autosave then
   * saves it as a new version, through the normal checks (a table archived since is named first).
   */
  function restore(snapshot: ShopLayout) {
    draft.change((layout) => {
      layout.floors = cloneFormValue(snapshot.floors)
      layout.placements = cloneFormValue(snapshot.placements)
      if (snapshot.scene) layout.scene = cloneFormValue(snapshot.scene)
      layout.pages = snapshot.pages && cloneFormValue(snapshot.pages)
    })
    if (!draft.layout.value.floors.some(floor => floor.id === floorId.value)) floorId.value = draft.layout.value.floors[0]?.id ?? null
    selection.value = null
  }

  async function latestLayout(): Promise<BranchLayout | null> {
    const latest = conflict.value?.latest ?? await fetchBranchLayout(branchId).catch(() => null)
    if (conflict.value && latest) conflict.value = { latest }
    return latest
  }

  /** Takes the latest layout instead of the draft, as one undo step (undo brings the draft back). */
  async function loadLatest() {
    const latest = await latestLayout()
    if (!latest) return
    applied = latest
    version.value = latest.version
    draft.change((layout) => {
      layout.floors = cloneFormValue(latest.floors)
      layout.placements = cloneFormValue(latest.placements)
      layout.scene = cloneFormValue(latest.scene)
      layout.pages = latest.pages && cloneFormValue(latest.pages)
    })
    unsaved.markClean(draft.layout.value)
    conflict.value = null
    query.data.value = latest
    if (!draft.layout.value.floors.some(floor => floor.id === floorId.value)) floorId.value = draft.layout.value.floors[0]?.id ?? null
    selection.value = null
  }

  /** Saves the draft over the latest layout, after asking. */
  async function overwrite() {
    const confirmed = await confirm({
      title: 'Overwrite with your draft?',
      description: 'The other changes will be replaced by yours. QR codes are not affected.',
      confirmLabel: 'Overwrite',
      danger: true,
    })
    if (!confirmed) return
    const latest = await latestLayout()
    if (latest) await send(latest.version)
  }

  function removeUnavailable() {
    const gone = new Set(unavailable.value.map(placement => placement.tableId))
    if (!gone.size) return
    draft.change((layout) => {
      layout.placements = layout.placements.filter(placement => !gone.has(placement.tableId))
    })
  }

  /**
   * Gives the tables whose look is gone the default look, at their own size, and the pieces whose
   * look is gone their own finishes again.
   */
  function resetUnknownLooks() {
    const gone = new Set(unknownLooks.value.map(placement => placement.tableId))
    const goneItems = new Set(unknownItemLooks.value.map(item => item.id))
    if (!gone.size && !goneItems.size) return
    draft.change((layout) => {
      for (const placement of layout.placements) {
        if (gone.has(placement.tableId)) placement.lookId = NEW_TABLE_LOOK
      }
      for (const item of layout.floors.flatMap(floor => floor.items)) {
        if (goneItems.has(item.id)) delete item.lookId
      }
    })
  }

  /** Shows a floor in Design shop, and clears the selection when it's another floor's. */
  function showFloor(id: string) {
    if (floorId.value === id) return
    floorId.value = id
    if (selection.value?.kind !== 'table') selection.value = null
  }

  /** Chooses the surroundings everyone sees in 3D (step 4a): a change to the draft, saved with it. */
  function setScene(preset: ScenePreset) {
    if ((draft.layout.value.scene ?? NO_SCENE).preset === preset) return
    draft.change((layout) => {
      layout.scene = { ...layout.scene, preset }
    })
  }

  /** Starts an empty layout from a starter (frame 6C); the scene stays. */
  function begin(layout: ShopLayout) {
    draft.change((current) => {
      current.floors = layout.floors
      current.placements = layout.placements
    })
    floorId.value = layout.floors[0]?.id ?? null
    selection.value = null
  }

  return {
    query,
    draft,
    version: readonly(version),
    tables,
    looks,
    itemLooks,
    unknownItemLooks,
    ready,
    error,
    retry,
    unavailable,
    unknownLooks,
    resetUnknownLooks,
    conflict: readonly(conflict),
    problem: readonly(problem),
    dismissProblem: () => void (problem.value = null),
    saving: readonly(saving),
    isDirty: unsaved.isDirty,
    floorId,
    selection,
    group: readonly(group),
    selected,
    selectMany,
    clipboard: computed(() => clipboard.value),
    copy,
    nextPasteOffset,
    load,
    save,
    restore,
    discard: () => applied && start(applied),
    loadLatest,
    overwrite,
    removeUnavailable,
    showFloor,
    setScene,
    begin,
  }
}

export type LayoutEditor = ReturnType<typeof useLayoutEditor>

/** One validation issue in words the owner can act on: which floor, and what's wrong. */
export function describeIssue(issue: v.BaseIssue<unknown> | undefined, layout: ShopLayout): string {
  if (!issue) return 'The layout has a problem.'
  const keys = issue.path?.map(item => item.key) ?? []
  if (keys[0] === 'floors' && typeof keys[1] === 'number') {
    const floor = layout.floors[keys[1]]
    if (floor && floor.outline.length === 0) return `Draw the ${floor.name} floor's outline first.`
    if (floor) return `${floor.name} floor: ${issue.message}`
  }
  return issue.message
}
