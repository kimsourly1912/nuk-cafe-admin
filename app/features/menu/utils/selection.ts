import type { PublicMenuItem, PublicMenuModifierGroup, PublicMenuVariation } from '#shared/contracts/public-menu'

/**
 * What a customer has chosen in an item's detail (D93): one value per option set (together they
 * name a version; the price lives on the version, D44) and the add-ons per group. Pure: the detail
 * component keeps a `Selection` and asks these functions what it means.
 */

export interface Selection {
  /** One value id per option set, in the item's option-set order (like a version's `valueIds`). */
  values: (string | undefined)[]
  /** Chosen add-on ids per group id. */
  modifiers: Record<string, string[]>
}

const orderable = (v: PublicMenuVariation) => !v.soldOut

/**
 * Where the detail starts: the first orderable version's values (the grid's order puts the usual
 * one first) and each group's pre-selected add-ons, as many as the group allows.
 */
export function defaultSelection(item: PublicMenuItem): Selection {
  const start = item.variations.find(orderable) ?? item.variations[0]
  return {
    values: item.optionSets.map((_, index) => start?.valueIds[index]),
    modifiers: Object.fromEntries(item.modifierGroups.map(group => [
      group.id,
      group.modifiers.filter(m => m.isDefault).slice(0, group.maxSelect ?? undefined).map(m => m.id),
    ])),
  }
}

/** The version the chosen values name, if the grid has it. */
export function variationOf(item: PublicMenuItem, selection: Selection): PublicMenuVariation | undefined {
  return item.variations.find(v => v.valueIds.every((id, index) => selection.values[index] === id))
}

/**
 * Whether choosing `valueId` for the option set at `setIndex` can give an orderable version, with
 * the other sets' current choices. With one option set: whether that version isn't sold out.
 */
export function isValueOrderable(item: PublicMenuItem, selection: Selection, setIndex: number, valueId: string): boolean {
  return item.variations.some(v => orderable(v)
    && v.valueIds[setIndex] === valueId
    && v.valueIds.every((id, index) => index === setIndex || selection.values[index] === undefined || selection.values[index] === id))
}

/**
 * Chooses a value. When the other sets' choices don't go with it (no such version, or sold out),
 * they move to the first orderable version that has it, so the customer never lands on nothing.
 */
export function chooseValue(item: PublicMenuItem, selection: Selection, setIndex: number, valueId: string): Selection {
  const values = selection.values.map((id, index) => (index === setIndex ? valueId : id))
  const next = { ...selection, values }
  const current = variationOf(item, next)
  if (current && orderable(current)) return next
  const fallback = item.variations.find(v => orderable(v) && v.valueIds[setIndex] === valueId)
  return fallback ? { ...selection, values: [...fallback.valueIds] } : next
}

/** Toggles an add-on: a group of one replaces the choice; others add up to their maximum. */
export function toggleModifier(group: PublicMenuModifierGroup, chosen: string[], modifierId: string): string[] {
  if (chosen.includes(modifierId)) return chosen.filter(id => id !== modifierId)
  if (group.maxSelect === 1) return [modifierId]
  if (group.maxSelect !== null && chosen.length >= group.maxSelect) return chosen
  // Kept in the group's order, so the same choice always reads (and keys) the same.
  return group.modifiers.map(m => m.id).filter(id => id === modifierId || chosen.includes(id))
}

/** "Required · choose 1", "Choose 1–2", "Optional · up to 3", "Optional". */
export function groupRule(group: PublicMenuModifierGroup): string {
  const { minSelect: min, maxSelect: max } = group
  if (min > 0) {
    if (max === min) return `Required · choose ${min}`
    return max === null ? `Required · choose at least ${min}` : `Required · choose ${min}–${max}`
  }
  return max === null ? 'Optional' : `Optional · up to ${max}`
}

/** A group whose choice isn't complete yet, with what's missing. */
export interface SelectionProblem {
  /** The group's id, or `'version'` when the chosen values name nothing orderable. */
  target: string
  /** For the button: "Choose Milk". */
  action: string
  /** Next to the group: "Choose 1". */
  message: string
}

/** What stops the selection from being added, in the order the detail shows it. */
export function selectionProblems(item: PublicMenuItem, selection: Selection): SelectionProblem[] {
  const problems: SelectionProblem[] = []
  const version = variationOf(item, selection)
  if (!version || !orderable(version)) {
    problems.push({ target: 'version', action: 'Choose another option', message: 'This option is sold out.' })
  }
  for (const group of item.modifierGroups) {
    const count = selection.modifiers[group.id]?.length ?? 0
    if (count < group.minSelect) {
      const missing = group.minSelect - count
      problems.push({ target: group.id, action: `Choose ${group.name}`, message: `Choose ${missing} more.` })
    }
  }
  return problems
}

/** One unit's price: the version's plus the chosen add-ons'. */
export function unitPriceOf(item: PublicMenuItem, selection: Selection): number {
  const version = variationOf(item, selection) ?? item.variations[0]
  const extras = item.modifierGroups.flatMap(group => group.modifiers.filter(m => selection.modifiers[group.id]?.includes(m.id)))
  return (version?.priceMinor ?? 0) + extras.reduce((sum, m) => sum + m.priceDeltaMinor, 0)
}

/** The chosen add-on ids, in menu order. */
export const chosenModifierIds = (item: PublicMenuItem, selection: Selection) =>
  item.modifierGroups.flatMap(group => group.modifiers.filter(m => selection.modifiers[group.id]?.includes(m.id)).map(m => m.id))
