import type { CounterItem, CounterMenuQuery, SetSoldOutInput } from '#shared/contracts/menu-sold-out'
import type { Db, Statement } from '../../utils/batch'
import { toIso } from '../../utils/time'
import type { BranchActor } from '../identity'
import { auditStatement } from '../platform'
import { itemNotFound, variationNotAvailable } from './items.errors'
import * as repo from './sold-out.repository'
import type { CounterItemRow, CounterVariationRow, VariationValueRow } from './sold-out.repository'

/**
 * The counter's sold-out switch (docs/server/data-model.md → Menu, D63): per branch and per
 * variation, set to a value (not toggled), so repeats and two staff at once end in the same state.
 * No version check: the switch is the only thing written, and the last one wins. It stays until
 * someone switches it back.
 */

function toCounterItems(items: CounterItemRow[], variations: CounterVariationRow[], values: VariationValueRow[]): CounterItem[] {
  const labels = new Map<string, VariationValueRow[]>()
  for (const value of values) labels.set(value.variationId, [...(labels.get(value.variationId) ?? []), value])
  const byItem = new Map<string, CounterVariationRow[]>()
  for (const variation of variations) byItem.set(variation.itemId, [...(byItem.get(variation.itemId) ?? []), variation])

  return items.flatMap((item) => {
    const own = byItem.get(item.id) ?? []
    // Published items always have a sellable variation, except while an option value is archived.
    if (!own.length) return []
    return [{
      id: item.id,
      name: item.name,
      categoryId: item.categoryId,
      categoryName: item.categoryName,
      soldOut: own.every(v => v.soldOut === true),
      variations: own.map(v => ({
        id: v.id,
        label: (labels.get(v.id) ?? []).sort((a, b) => a.setOrder - b.setOrder).map(value => value.name).join(', '),
        priceMinor: v.priceMinor,
        soldOut: v.soldOut === true,
        soldOutChangedAt: v.changedAt ? toIso(v.changedAt) : null,
      })),
    }]
  })
}

async function loadCounterItem(db: Db, branchId: string, itemId: string): Promise<CounterItem | undefined> {
  const [items, variations, values] = await Promise.all([
    repo.visibleItems(db, { itemId }),
    repo.visibleVariations(db, branchId, itemId),
    repo.variationValues(db, itemId),
  ])
  return toCounterItems(items, variations, values)[0]
}

/** What customers can order, with this branch's sold-out switches, in menu order. */
export async function listCounterMenu(db: Db, branchId: string, query: CounterMenuQuery): Promise<CounterItem[]> {
  const [items, variations, values] = await Promise.all([
    repo.visibleItems(db, { search: query.search }),
    repo.visibleVariations(db, branchId),
    repo.variationValues(db),
  ])
  const menu = toCounterItems(items, variations, values)
  return query.soldOut ? menu.filter(item => item.variations.some(v => v.soldOut)) : menu
}

/**
 * Switches variations of an item sold out (or back) in the actor's branch: the listed ones, or all
 * the item sells. Only items and variations the counter sells can be switched. Nothing changes and
 * nothing is audited when they're already in that state.
 */
export async function setSoldOut(db: Db, actor: BranchActor, itemId: string, input: SetSoldOutInput): Promise<CounterItem> {
  const item = await loadCounterItem(db, actor.branchId, itemId)
  if (!item) throw itemNotFound()

  const sold = new Map(item.variations.map(v => [v.id, v.soldOut]))
  input.variationIds?.forEach((id, i) => {
    if (!sold.has(id)) throw variationNotAvailable(i)
  })
  const changing = (input.variationIds ?? [...sold.keys()]).filter(id => sold.get(id) !== input.soldOut)
  if (!changing.length) return item

  const statements: Statement[] = [
    ...repo.setSoldOutStatements(db, actor.branchId, changing, input.soldOut, actor.userId, new Date()),
    auditStatement(db, actor, {
      action: input.soldOut ? 'menu.item.sold_out' : 'menu.item.back_in_stock',
      targetType: 'menu_item',
      targetId: itemId,
      branchId: actor.branchId,
      metadata: { variations: changing.length, of: sold.size },
    }),
  ]
  await db.batch(statements as [Statement, ...Statement[]])
  // Unpublished in the meantime: the switch is saved all the same; answer with what was written.
  return await loadCounterItem(db, actor.branchId, itemId)
    ?? { ...item, soldOut: item.variations.every(v => changing.includes(v.id) ? input.soldOut : v.soldOut), variations: item.variations.map(v => changing.includes(v.id) ? { ...v, soldOut: input.soldOut } : v) }
}
