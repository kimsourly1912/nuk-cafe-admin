import { MAX_MODIFIERS } from '#shared/contracts/menu-modifiers'

/** Pure rules for add-on groups (no I/O). */

export interface SelectionState {
  minSelect: number
  maxSelect: number | null
  /** Active add-ons in the group. */
  active: number
  /** Active add-ons marked as default. */
  defaults: number
}

/**
 * Why a group's rules can't be met, or `undefined` when they can. A customer must be able to
 * choose `minSelect` add-ons, the pre-selected defaults must fit under `maxSelect`, and a group
 * holds 1 to 30 active add-ons.
 */
export function selectionProblem(state: SelectionState): { field: string, message: string } | undefined {
  if (state.maxSelect !== null && state.maxSelect < state.minSelect) return { field: 'maxSelect', message: 'Can\'t be less than the minimum' }
  if (state.active < 1) return { field: 'modifiers', message: 'A group needs at least one active add-on. Archive the group instead.' }
  if (state.active > MAX_MODIFIERS) return { field: 'modifiers', message: `A group can have at most ${MAX_MODIFIERS} active add-ons.` }
  if (state.minSelect > state.active) return { field: 'minSelect', message: `Customers must choose ${state.minSelect}, but only ${state.active} ${state.active === 1 ? 'add-on is' : 'add-ons are'} active.` }
  if (state.maxSelect !== null && state.defaults > state.maxSelect) return { field: 'modifiers', message: `${state.defaults} add-ons are pre-selected, but customers may choose at most ${state.maxSelect}.` }
  return undefined
}
