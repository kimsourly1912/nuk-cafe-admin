import * as v from 'valibot'
import { layoutSchema } from '#shared/contracts/shop-layout'
import type { BranchLayout, LayoutTable, Placement, ShopLayout } from '#shared/contracts/shop-layout'
import type { PlanSelection } from '../designer/plan'
import { fetchBranchLayout, useBranchLayout, useLayoutMutations } from './useBranches'
import { useLayoutDraft } from './useLayoutDraft'
import type { LayoutDraft } from './useLayoutDraft'

/**
 * A branch's shop layout being edited (D273, step 2b): the saved layout from the server, the draft
 * on top of it, and the version the draft started from.
 *
 * - **Saved vs draft.** With nothing unsaved, the draft follows the server (a refetch after a table
 *   change, or another device's save seen on return). With unsaved changes it is kept, and its
 *   save names the version it started from.
 * - **A stale save (409 `VERSION_CONFLICT`)** keeps the draft and offers the choice (frame 6A):
 *   `loadLatest` puts the latest layout in place as one undo step, so undo brings the draft back
 *   on top of it; `overwrite` asks first, then saves the draft at the latest version.
 * - **A placed table that is no longer active** (archived or deleted elsewhere) is listed in
 *   `unavailable`; the server refuses the save while it is placed (409
 *   `LAYOUT_TABLE_UNAVAILABLE`), and `removeUnavailable` takes it off the map.
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
    return false
  }

  /** Loads the layout the first time it's needed. */
  function load() {
    if (query.status.value === 'idle') void query.execute()
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
    unavailable,
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
