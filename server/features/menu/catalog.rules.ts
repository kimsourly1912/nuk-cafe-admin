import type { PublicMenuCategory, PublicMenuItem, PublicMenuModifierGroup, PublicMenuVariation } from '#shared/contracts/public-menu'
import type { LocalTime, RuleForCheck } from './availability.rules'
import { isAvailableAt } from './availability.rules'

/**
 * Pure rules of the customer menu (no I/O; D65). The catalog is everything the menu could show,
 * independent of the time and the branch; `menuAt` narrows it to one moment at one branch. The
 * catalog is the part a cache would hold.
 */

export interface CatalogCategory {
  id: string
  parentId: string | null
  name: string
  description: string
  ruleIds: string[]
}

export interface CatalogItem {
  id: string
  categoryId: string
  name: string
  description: string
  imageUrl: string | null
  ruleIds: string[]
  /** The item's option sets in grid order, with their active values in order. */
  optionSets: { id: string, name: string, values: { id: string, name: string }[] }[]
  /** Sellable versions only (active, priced, no archived value), in grid order. */
  variations: Omit<PublicMenuVariation, 'soldOut'>[]
  /** Active groups, with active add-ons and the rules and prices that apply on this item. */
  modifierGroups: PublicMenuModifierGroup[]
}

export interface Catalog {
  /** Active categories, each parent before its sub-categories, in menu order. */
  categories: CatalogCategory[]
  /** Active items in menu order. */
  items: CatalogItem[]
  /** Every rule an item or category uses, by id (archived ones included: they never match). */
  rules: Record<string, RuleForCheck>
}

/** A rule id without a rule counts as a rule that never matches (fail closed). */
const NEVER: RuleForCheck = { status: 'archived', windows: [] }

/**
 * The item as a customer sees it now, or `null` when it isn't sold now: not available at `at`
 * (its own rules, its category's and the parent's). Sold-out versions stay, marked (D93); an item
 * whose versions are all sold out is marked too.
 */
function itemAt(item: CatalogItem, levels: string[][], rules: Catalog['rules'], at: LocalTime, soldOut: ReadonlySet<string>): PublicMenuItem | null {
  if (!isAvailableAt(levels.map(ids => ids.map(id => rules[id] ?? NEVER)), at)) return null
  const variations = item.variations.map(v => ({ ...v, soldOut: soldOut.has(v.id) }))
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    imageUrl: item.imageUrl,
    // Only the values some version uses (a value with no sellable version isn't offered at all).
    optionSets: item.optionSets.map(set => ({ ...set, values: set.values.filter(value => item.variations.some(v => v.valueIds.includes(value.id))) })),
    variations,
    soldOut: variations.every(v => v.soldOut),
    modifierGroups: item.modifierGroups,
  }
}

/**
 * The menu at one moment (`at`, the branch's wall clock) with the branch's sold-out versions:
 * available items only, sold-out versions marked, and no empty categories.
 */
export function menuAt(catalog: Catalog, at: LocalTime, soldOut: ReadonlySet<string>): PublicMenuCategory[] {
  const categories = new Map(catalog.categories.map(c => [c.id, c]))
  const itemsOf = (category: CatalogCategory) => {
    const levels = [category.ruleIds, ...(category.parentId ? [categories.get(category.parentId)?.ruleIds ?? []] : [])]
    return catalog.items
      .filter(item => item.categoryId === category.id)
      .flatMap((item) => {
        const shown = itemAt(item, [item.ruleIds, ...levels], catalog.rules, at, soldOut)
        return shown ? [shown] : []
      })
  }
  return catalog.categories
    .filter(c => c.parentId === null)
    .flatMap((top) => {
      const subs = catalog.categories
        .filter(c => c.parentId === top.id)
        .map(sub => ({ id: sub.id, name: sub.name, description: sub.description, categories: [], items: itemsOf(sub) }))
        .filter(sub => sub.items.length)
      const items = itemsOf(top)
      return subs.length || items.length ? [{ id: top.id, name: top.name, description: top.description, categories: subs, items }] : []
    })
}

/** An item's add-on group on the customer menu: what applies on it, only active add-ons. */
export function groupOnItem(group: { id: string, name: string, minSelect: number, maxSelect: number | null }, modifiers: { id: string, name: string, priceDeltaMinor: number, isDefault: boolean }[]): PublicMenuModifierGroup | null {
  if (!modifiers.length) return null
  // An item's own minimum isn't re-checked when the library changes (D61): cap it at what's offered.
  return { ...group, minSelect: Math.min(group.minSelect, modifiers.length), modifiers }
}
