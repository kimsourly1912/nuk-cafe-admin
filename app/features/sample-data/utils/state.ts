import type { SampleDataState, SampleMenuSize, SampleMenuStage } from '#shared/contracts/sample-data'
import { SAMPLE_MENU_ITEMS } from '#shared/contracts/sample-data'
import { pluralize } from '~/utils/text'

/** How the Sample data page reads the server's state (D94). Pure, unit-tested. */

type MenuCounts = SampleDataState['menu']['counts']

export const SIZE_OPTIONS: { value: SampleMenuSize, label: string, description: string }[] = [
  { value: 'small', label: 'Small', description: `${SAMPLE_MENU_ITEMS.small} items` },
  { value: 'standard', label: 'Standard', description: `${SAMPLE_MENU_ITEMS.standard} items` },
  { value: 'large', label: 'Large', description: `${SAMPLE_MENU_ITEMS.large} items` },
]

export const itemCount = (counts: MenuCounts) => counts.items.active + counts.items.draft + counts.items.archived

export const isMenuEmpty = (counts: MenuCounts) =>
  !counts.categories && !counts.optionSets && !counts.modifierGroups && !counts.availabilityRules && !itemCount(counts)

/** Anything a reset would delete. */
export const hasResettable = (state: SampleDataState) => !isMenuEmpty(state.menu.counts) || state.menu.counts.photos > 0 || !!state.menu.run

/**
 * The Sample menu card's state: an empty menu (load), a menu with other data (reset first), a load
 * that stopped partway (continue), or the loaded sample menu.
 */
export function menuStatus(state: SampleDataState): 'empty' | 'other' | 'partial' | 'loaded' {
  const run = state.menu.run
  if (run) return run.finished ? 'loaded' : 'partial'
  return isMenuEmpty(state.menu.counts) ? 'empty' : 'other'
}

/** "8 categories, 3 option sets, 4 add-on groups, 2 rules, 40 items (35 published, 3 drafts, 2 archived)". */
export function menuSummary(counts: MenuCounts): string {
  const { active, draft, archived } = counts.items
  const states = [
    active && `${active} published`,
    draft && pluralize(draft, ['draft', 'drafts']),
    archived && `${archived} archived`,
  ].filter(Boolean).join(', ')
  return [
    pluralize(counts.categories, ['category', 'categories']),
    pluralize(counts.optionSets, ['option set', 'option sets']),
    pluralize(counts.modifierGroups, ['add-on group', 'add-on groups']),
    pluralize(counts.availabilityRules, ['rule', 'rules']),
    `${pluralize(itemCount(counts), ['item', 'items'])}${states ? ` (${states})` : ''}`,
  ].join(', ')
}

/** The step a load is on (or would continue from): the first one not complete. */
export const currentStage = (stages: SampleMenuStage[]) => stages.find(stage => stage.done < stage.total)

/** "Hours set · 12 tables", "No hours set · 0 tables". */
export const branchSummary = (branch: SampleDataState['branches'][number]) =>
  `${branch.hoursSet ? 'Hours set' : 'No hours set'} · ${pluralize(branch.tables, ['table', 'tables'])}`
