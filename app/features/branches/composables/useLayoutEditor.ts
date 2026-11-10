import * as v from 'valibot'
import { layoutSchema } from '#shared/contracts/shop-layout'
import type { BranchLayout, LayoutTable, Placement, ShopLayout, TableLook } from '#shared/contracts/shop-layout'
import { BUILT_IN_LOOKS, NEW_TABLE_LOOK } from '../designer/catalog'
import type { PlanSelection } from '../designer/plan'
import { fetchBranchLayout, useBranchLayout, useLayoutMutations, useLooks } from './useBranches'
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
 *   `resetUnknownLooks` gives those tables the default look.
 * - **Leaving with unsaved changes asks first** (`useUnsavedChanges`, the app's guard); Discard
 *   puts the saved layout back.
 *
 * Owned by the branch page, so switching between Table list, Design shop and View in 3D keeps it.
 * Leaving the page drops it, and changing cafes is a full page load. Nothing loads until `load()`
 * (the first time Design shop or View in 3D opens): the table list doesn't need the layout.
 */

export interface LayoutConflict {
  /** The layout as saved now; `null` while it loads or when it couldn't be read. */
  latest: BranchLayout | null
}

export function useLayoutEditor(branchId: string) {
  const query = useBranchLayout(branchId, { immediate: false })
  const looksQuery = useLooks({ immediate: false })
  const { save: saveMutation } = useLayoutMutations()
  const confirm = useConfirm()
  const draft: LayoutDraft = useLayoutDraft({ floors: [], placements: [] })

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
  /** The layout and the looks are both here: the editor and the 3D view draw only then. */
  const ready = computed(() => !!query.data.value && !!looksQuery.data.value)
  const error = computed(() => (query.data.value ? null : query.error.value) ?? (looksQuery.data.value ? null : looksQuery.error.value))

  function start(layout: BranchLayout) {
    applied = layout
    version.value = layout.version
    draft.reset({ floors: cloneFormValue(layout.floors), placements: cloneFormValue(layout.placements) })
    unsaved.markClean(draft.layout.value)
    conflict.value = null
    problem.value = null
    if (!draft.layout.value.floors.some(floor => floor.id === floorId.value)) floorId.value = draft.layout.value.floors[0]?.id ?? null
    selection.value = null
  }

  watch(query.data, (layout) => {
    if (!layout || layout === applied || unsaved.isDirty.value) return
    // The same drawing again (a refetch after a table or a look changed): the selection and the
    // undo history stay. Only its tables are news, and those are read from the query.
    if (applied && isSameFormValue(layout.floors, draft.layout.value.floors) && isSameFormValue(layout.placements, draft.layout.value.placements)) {
      applied = layout
      version.value = layout.version
      return
    }
    start(layout)
  }, { immediate: true })

  /** Sends the draft at `at` (the version read, or the latest one when overwriting). */
  async function send(at: number): Promise<boolean> {
    if (saving.value) return false
    const parsed = v.safeParse(layoutSchema, draft.layout.value)
    if (!parsed.success) {
      problem.value = describeIssue(parsed.issues[0], draft.layout.value)
      return false
    }
    problem.value = null
    const sent = draft.layout.value
    saving.value = true
    const result = await saveMutation.execute({ branchId, body: { version: at, layout: parsed.output } })
    saving.value = false
    if (result.ok) {
      applied = result.data
      version.value = result.data.version
      conflict.value = null
      // What was sent is saved; anything changed while it was on its way is still unsaved.
      unsaved.markClean(sent)
      query.data.value = result.data
      // Which looks the saved tables use changed with it (a look in use can't be deleted).
      if (looksQuery.data.value?.length) void looksQuery.refresh()
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
    // A look was deleted: refetch the looks, so the editor names the tables that used it.
    if (result.error.code === 'LAYOUT_LOOK_UNAVAILABLE') void looksQuery.refresh()
    return false
  }

  /** Loads the layout and the looks the first time they're needed. */
  function load() {
    if (query.status.value === 'idle') void query.execute()
    if (looksQuery.status.value === 'idle') void looksQuery.execute()
  }

  /** Loads again whichever of the two failed. */
  function retry() {
    if (!query.data.value) void query.refresh()
    if (!looksQuery.data.value) void looksQuery.refresh()
  }

  function save() {
    return send(version.value)
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

  /** Gives the tables whose look is gone the default look, at their own size. */
  function resetUnknownLooks() {
    const gone = new Set(unknownLooks.value.map(placement => placement.tableId))
    if (!gone.size) return
    draft.change((layout) => {
      for (const placement of layout.placements) {
        if (gone.has(placement.tableId)) placement.lookId = NEW_TABLE_LOOK
      }
    })
  }

  /** Shows a floor in Design shop, and clears the selection when it's another floor's. */
  function showFloor(id: string) {
    if (floorId.value === id) return
    floorId.value = id
    if (selection.value?.kind !== 'table') selection.value = null
  }

  /** Starts an empty layout from a starter (frame 6C). */
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
    load,
    save,
    loadLatest,
    overwrite,
    removeUnavailable,
    showFloor,
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
