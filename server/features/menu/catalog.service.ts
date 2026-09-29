import type { PublicMenu, PublicMenuQuery } from '#shared/contracts/public-menu'
import type { Db } from '../../utils/batch'
import { toIso } from '../../utils/time'
import { getPublicBranch } from '../branches'
import { assetUrls } from '../media'
import type { RuleForCheck } from './availability.rules'
import { localTime } from './availability.rules'
import * as repo from './catalog.repository'
import type { Catalog } from './catalog.rules'
import { groupOnItem, menuAt } from './catalog.rules'
import { soldOutIds } from './soldout.repository'

/**
 * The customer menu (docs/server/data-model.md → Menu, D65): the catalog (what could be sold,
 * independent of time and branch) narrowed to one branch at one moment. No cache yet (D65):
 * `loadCatalog` is the function a cache would wrap, purged on menu writes.
 */

const groupBy = <T, K>(rows: T[], key: (row: T) => K) => {
  const map = new Map<K, T[]>()
  for (const row of rows) map.set(key(row), [...(map.get(key(row)) ?? []), row])
  return map
}

/** Everything the customer menu could show: active categories and items, sellable versions. */
export async function loadCatalog(db: Db): Promise<Catalog> {
  const [categories, categoryLinks, items, itemLinks, variations, itemSets, values, itemGroups, modifiers, ownPrices, rules, windows] = await Promise.all([
    repo.activeCategories(db),
    repo.categoryRuleLinks(db),
    repo.activeItems(db),
    repo.itemRuleLinks(db),
    repo.sellableVariations(db),
    repo.itemOptionSets(db),
    repo.activeOptionValues(db),
    repo.itemModifierGroups(db),
    repo.activeModifiers(db),
    repo.itemModifierPrices(db),
    repo.allRules(db),
    repo.allWindows(db),
  ])
  const images = await assetUrls(db, items.flatMap(i => i.imageAssetId ? [i.imageAssetId] : []))

  const categoryRules = groupBy(categoryLinks, l => l.categoryId)
  const itemRules = groupBy(itemLinks, l => l.itemId)
  const variationsOf = groupBy(variations, v => v.itemId)
  const setsOf = groupBy(itemSets, s => s.itemId)
  const valuesOf = groupBy(values, v => v.setId)
  const valueNames = new Map(values.map(v => [v.id, v.name]))
  const valueSet = new Map(values.map(v => [v.id, v.setId]))
  const groupsOf = groupBy(itemGroups, g => g.itemId)
  const modifiersOf = groupBy(modifiers, m => m.groupId)
  const pricesOf = new Map([...groupBy(ownPrices, p => p.itemId)].map(([itemId, list]) => [itemId, new Map(list.map(p => [p.modifierId, p.priceDeltaMinor]))]))
  const windowsOf = groupBy(windows, w => w.ruleId)

  // Only categories whose parent is active too (an active sub-category always has one; kept safe).
  const active = new Set(categories.filter(c => c.parentId === null).map(c => c.id))
  const shown = categories.filter(c => c.parentId === null || active.has(c.parentId))
  const shownIds = new Set(shown.map(c => c.id))

  return {
    categories: shown.map(c => ({ ...c, ruleIds: (categoryRules.get(c.id) ?? []).map(l => l.ruleId) })),
    items: items.filter(item => shownIds.has(item.categoryId)).flatMap((item) => {
      const sets = setsOf.get(item.id) ?? []
      const setOrder = new Map(sets.map((s, i) => [s.setId, i]))
      const own = pricesOf.get(item.id) ?? new Map<string, number>()
      const sellable = (variationsOf.get(item.id) ?? []).map((v) => {
        const valueIds = (v.combinationKey ? v.combinationKey.split(',') : [])
          .sort((a, b) => (setOrder.get(valueSet.get(a) ?? '') ?? 0) - (setOrder.get(valueSet.get(b) ?? '') ?? 0))
        return { id: v.id, valueIds, label: valueIds.map(id => valueNames.get(id) ?? '').join(', '), priceMinor: v.priceMinor }
      })
      if (!sellable.length) return []
      return [{
        id: item.id,
        categoryId: item.categoryId,
        name: item.name,
        description: item.description,
        imageUrl: item.imageAssetId ? images.get(item.imageAssetId) ?? null : null,
        ruleIds: (itemRules.get(item.id) ?? []).map(l => l.ruleId),
        optionSets: sets.map(s => ({ id: s.setId, name: s.name, values: (valuesOf.get(s.setId) ?? []).map(v => ({ id: v.id, name: v.name })) })),
        variations: sellable,
        modifierGroups: (groupsOf.get(item.id) ?? []).flatMap((g) => {
          const group = groupOnItem(
            { id: g.groupId, name: g.name, minSelect: g.rulesOverridden ? g.ownMin ?? 0 : g.groupMin, maxSelect: g.rulesOverridden ? g.ownMax : g.groupMax },
            (modifiersOf.get(g.groupId) ?? []).map(m => ({ id: m.id, name: m.name, priceDeltaMinor: own.get(m.id) ?? m.priceDeltaMinor, isDefault: m.isDefault })),
          )
          return group ? [group] : []
        }),
      }]
    }),
    rules: Object.fromEntries(rules.map((r): [string, RuleForCheck] => [r.id, { status: r.status, windows: (windowsOf.get(r.id) ?? []).map(({ ruleId: _, ...w }) => w) }])),
  }
}

/**
 * What the branch sells at `now`: available items (in the branch's time zone), their versions marked
 * sold out or not there, and whether the branch is open. Unknown and archived branches are 404.
 */
export async function getPublicMenu(db: Db, query: PublicMenuQuery, now = new Date()): Promise<PublicMenu> {
  const branch = await getPublicBranch(db, query.branchId, now)
  const [catalog, soldOut] = await Promise.all([loadCatalog(db), soldOutIds(db, branch.id)])
  return {
    branch,
    currency: 'USD',
    at: toIso(now),
    categories: menuAt(catalog, localTime(now, branch.timezone), soldOut),
  }
}
