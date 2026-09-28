import type { ModifierGroup } from '#shared/contracts/menu-modifiers'
import { formatMinor } from '~/utils/money'

/**
 * What the Add-ons pages (and the menu-item form) show in words (D75). Pure, so the wording is
 * unit-tested once. Labels are derived from `minSelect` / `maxSelect` every time, never stored.
 */

export interface RuleParts {
  /** The badge: whether the customer must choose. */
  kind: 'Required' | 'Optional'
  /** "Choose exactly 1", "Up to 3", "Choose any". */
  summary: string
}

/** The selection rule split into a badge and a summary. */
export function ruleParts(minSelect: number, maxSelect: number | null): RuleParts {
  if (minSelect === 0) return { kind: 'Optional', summary: maxSelect === null ? 'Choose any' : `Up to ${maxSelect}` }
  if (maxSelect === null) return { kind: 'Required', summary: `Choose at least ${minSelect}` }
  if (maxSelect === minSelect) return { kind: 'Required', summary: `Choose exactly ${minSelect}` }
  return { kind: 'Required', summary: `Choose ${minSelect}–${maxSelect}` }
}

/** The rule in one line: "Optional · up to 2", "Required · choose exactly 1". */
export function describeRules(minSelect: number, maxSelect: number | null): string {
  const { kind, summary } = ruleParts(minSelect, maxSelect)
  return `${kind} · ${summary.charAt(0).toLowerCase()}${summary.slice(1)}`
}

/** What the customer sees, as a sentence under the settings: "Customers must choose exactly 1." */
export function explainRules(minSelect: number, maxSelect: number | null): string {
  if (minSelect === 0) return maxSelect === null ? 'Customers may choose any number, or none.' : `Customers may choose up to ${maxSelect}, or none.`
  if (maxSelect === null) return `Customers must choose at least ${minSelect}.`
  if (maxSelect === minSelect) return `Customers must choose exactly ${minSelect}.`
  return `Customers must choose ${minSelect} to ${maxSelect}.`
}

/** `50` → `"+$0.50"`, `0` → `"Free"`. */
export const formatDelta = (priceMinor: number) => (priceMinor ? `+${formatMinor(priceMinor)}` : 'Free')

/** "Offered by 18 menu items", "Offered by 1 menu item" or "Unused". */
export function usageLabel(itemCount: number) {
  return itemCount ? `Offered by ${itemCount} ${itemCount === 1 ? 'menu item' : 'menu items'}` : 'Unused'
}

/**
 * Whether a group matches the search, by its name or an active add-on's name (case and spaces
 * ignored). `addOns` are the active add-ons that match, for the card's "Matches" line.
 */
export function searchModifierGroup(group: ModifierGroup, search: string): { addOns: string[] } | null {
  const term = search.trim().toLowerCase()
  if (!term) return { addOns: [] }
  const addOns = group.modifiers.filter(m => m.status === 'active' && m.name.toLowerCase().includes(term)).map(m => m.name)
  if (!addOns.length && !group.name.toLowerCase().includes(term)) return null
  return { addOns }
}
