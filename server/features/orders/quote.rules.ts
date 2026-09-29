import type { CheckoutQuote, OrderLineInput, QuoteLine, QuoteLineProblem } from '#shared/contracts/orders'
import { LAST_ORDERS_MINUTES, QUOTE_TTL_MINUTES } from '#shared/contracts/orders'
import type { PublicMenu, PublicMenuItem } from '#shared/contracts/public-menu'

/**
 * Pricing (step 6.1, D98), pure: the lines read against the menu the branch sells now. The menu
 * already applies availability rules, active versions and add-ons, their prices on the item, and
 * the branch's sold-out switches (D65, D93); here each line is checked against it and priced.
 * Money is whole cents throughout; menu prices are final (no tax or service charge, D45).
 */

const MINUTE = 60_000

export const menuItems = (menu: PublicMenu): PublicMenuItem[] =>
  menu.categories.flatMap(category => [...category.items, ...category.categories.flatMap(sub => sub.items)])

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** What's wrong with the add-ons chosen for `item`, if anything. */
function choiceProblem(item: PublicMenuItem, modifierIds: string[]): QuoteLineProblem | null {
  const offered = new Map(item.modifierGroups.flatMap(group => group.modifiers.map(m => [m.id, group.id] as const)))
  const gone = modifierIds.filter(id => !offered.has(id))
  if (gone.length) {
    return { code: 'ADD_ON_UNAVAILABLE', message: gone.length === 1 ? 'An add-on you chose is no longer available.' : 'Some add-ons you chose are no longer available.', modifierIds: gone }
  }
  for (const group of item.modifierGroups) {
    const chosen = modifierIds.filter(id => offered.get(id) === group.id).length
    if (chosen < group.minSelect) {
      return { code: 'CHOICE_INVALID', message: `Choose ${group.maxSelect === group.minSelect ? '' : 'at least '}${plural(group.minSelect, 'option', 'options')} for ${group.name}.` }
    }
    if (group.maxSelect !== null && chosen > group.maxSelect) {
      return { code: 'CHOICE_INVALID', message: `Choose up to ${plural(group.maxSelect, 'option', 'options')} for ${group.name}.` }
    }
  }
  return null
}

/** One line against the menu: priced, or with the first problem found. */
export function quoteLine(items: ReadonlyMap<string, PublicMenuItem>, line: OrderLineInput): QuoteLine {
  const base = { itemId: line.itemId, variationId: line.variationId, modifierIds: line.modifierIds, quantity: line.quantity, note: line.note }
  const unpriced = (problem: QuoteLineProblem, item?: PublicMenuItem, detail = '', modifiers: QuoteLine['modifiers'] = []): QuoteLine =>
    ({ ...base, name: item?.name ?? null, detail, modifiers, imageUrl: item?.imageUrl ?? null, unitPriceMinor: null, totalMinor: null, problem })

  const item = items.get(line.itemId)
  if (!item) return unpriced({ code: 'ITEM_UNAVAILABLE', message: 'This item isn\'t on the menu right now.' })
  const version = item.variations.find(v => v.id === line.variationId)
  if (!version) return unpriced({ code: 'VERSION_UNAVAILABLE', message: 'The version you chose is no longer available.' }, item)

  const addOns = new Map(item.modifierGroups.flatMap(group => group.modifiers).map(m => [m.id, m]))
  // In menu order, whatever order they were sent in.
  const chosen = [...addOns.values()].filter(m => line.modifierIds.includes(m.id)).map(m => ({ id: m.id, name: m.name, priceDeltaMinor: m.priceDeltaMinor }))
  const detail = [version.label, chosen.map(m => m.name).join(', ')].filter(Boolean).join(' · ')
  const problem = choiceProblem(item, line.modifierIds)
  if (problem) return unpriced(problem, item, detail, chosen)
  if (version.soldOut) return unpriced({ code: 'SOLD_OUT', message: 'Sold out.' }, item, detail, chosen)

  const unitPriceMinor = version.priceMinor + chosen.reduce((sum, m) => sum + m.priceDeltaMinor, 0)
  return { ...base, name: item.name, detail, modifiers: chosen, imageUrl: item.imageUrl, unitPriceMinor, totalMinor: unitPriceMinor * line.quantity, problem: null }
}

/**
 * Why the branch takes no online order now: closed, or closing within `LAST_ORDERS_MINUTES` (Q40:
 * the counter can't take payment after closing).
 */
export function orderProblems(branch: PublicMenu['branch']): CheckoutQuote['problems'] {
  if (!branch.openNow) return [{ code: 'BRANCH_CLOSED', message: `${branch.name} is closed now.` }]
  if (branch.closesInMinutes !== null && branch.closesInMinutes <= LAST_ORDERS_MINUTES) {
    return [{ code: 'LAST_ORDERS_PASSED', message: `Online orders close ${LAST_ORDERS_MINUTES} minutes before ${branch.name} closes.` }]
  }
  return []
}

/** The quote for `lines` against `menu` (the branch's menu at `menu.at`). */
export function quoteOrder(menu: PublicMenu, lines: OrderLineInput[]): CheckoutQuote {
  const items = new Map(menuItems(menu).map(item => [item.id, item]))
  const quoted = lines.map(line => quoteLine(items, line))
  const subtotalMinor = quoted.reduce((sum, line) => sum + (line.totalMinor ?? 0), 0)
  const problems = orderProblems(menu.branch)
  return {
    branch: menu.branch,
    currency: menu.currency,
    at: menu.at,
    expiresAt: new Date(Date.parse(menu.at) + QUOTE_TTL_MINUTES * MINUTE).toISOString(),
    lines: quoted,
    subtotalMinor,
    totalMinor: subtotalMinor,
    problems,
    orderable: !problems.length && quoted.every(line => !line.problem),
  }
}
