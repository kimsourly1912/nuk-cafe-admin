import type { Discount, PromotionPhase, PromotionScope, PromotionStatus, PromotionTag, PublicPromotion } from '#shared/contracts/menu-promotions'
import { discountLabel, discountOff } from '#shared/contracts/menu-promotions'
import type { PublicMenuCategory, PublicMenuItem } from '#shared/contracts/public-menu'

/**
 * Promotions' pure rules (M1, D163): which phase a promotion is in, and the menu's prices with the
 * live promotions applied. No I/O: the repository finds what runs at a branch today, and this
 * decides prices, so the menu, the checkout quote and the order agree by construction.
 */

/** A promotion running at one branch today, as pricing needs it. */
export interface LivePromotion {
  id: string
  name: string
  description: string
  discount: Discount
  scope: PromotionScope
  itemIds: ReadonlySet<string>
  /** A main category here includes its sub-categories. */
  categoryIds: ReadonlySet<string>
  endsOn: string | null
  posterUrl: string | null
}

/**
 * What an admin reads: a draft; ended by hand or past its last day; before its first day,
 * scheduled; otherwise live. `today` is `YYYY-MM-DD` (dates compare as text).
 */
export function promotionPhase(promotion: { status: PromotionStatus, startsOn: string, endsOn: string | null }, today: string): PromotionPhase {
  if (promotion.status === 'draft') return 'draft'
  if (promotion.status === 'ended' || (promotion.endsOn !== null && promotion.endsOn < today)) return 'ended'
  return promotion.startsOn > today ? 'scheduled' : 'live'
}

export const toTag = (promotion: Pick<LivePromotion, 'id' | 'name' | 'discount'>): PromotionTag =>
  ({ id: promotion.id, name: promotion.name, label: discountLabel(promotion.discount) })

/** `item` with each version at its best price among `applying` (the bigger discount; on a tie, the first). */
function priceItem(item: PublicMenuItem, applying: LivePromotion[]): PublicMenuItem {
  if (!applying.length) return item
  let badge: { promotion: LivePromotion, off: number } | undefined
  const variations: PublicMenuItem['variations'] = []
  for (const version of item.variations) {
    let best: { promotion: LivePromotion, off: number } | undefined
    for (const promotion of applying) {
      const off = discountOff(promotion.discount, version.priceMinor)
      if (off > (best?.off ?? 0)) best = { promotion, off }
    }
    if (!best) {
      variations.push(version)
      continue
    }
    if (best.off > (badge?.off ?? 0)) badge = best
    variations.push({ ...version, priceMinor: version.priceMinor - best.off, regularPriceMinor: version.priceMinor, promotion: toTag(best.promotion) })
  }
  return { ...item, variations, promotion: badge ? toTag(badge.promotion) : null }
}

/**
 * The menu with `promotions` applied: each version at its lowest price, never two discounts
 * together; add-ons keep their price (they aren't touched here). Also the promotions that lowered
 * something, for the menu's offers, in `promotions`' order.
 */
export function applyPromotions(categories: PublicMenuCategory[], promotions: LivePromotion[]): { categories: PublicMenuCategory[], promotions: PublicPromotion[] } {
  if (!promotions.length) return { categories, promotions: [] }
  const itemsOf = new Map<string, string[]>(promotions.map(p => [p.id, []]))
  const price = (item: PublicMenuItem, categoryIds: string[]) => {
    const applying = promotions.filter(p => p.scope === 'menu' || p.itemIds.has(item.id) || categoryIds.some(id => p.categoryIds.has(id)))
    const priced = priceItem(item, applying)
    for (const id of new Set(priced.variations.flatMap(v => v.promotion ? [v.promotion.id] : []))) itemsOf.get(id)!.push(item.id)
    return priced
  }
  const priced = categories.map(top => ({
    ...top,
    items: top.items.map(item => price(item, [top.id])),
    categories: top.categories.map(sub => ({ ...sub, items: sub.items.map(item => price(item, [sub.id, top.id])) })),
  }))
  return {
    categories: priced,
    promotions: promotions.flatMap((p) => {
      const itemIds = itemsOf.get(p.id)!
      return itemIds.length ? [{ id: p.id, name: p.name, description: p.description, label: discountLabel(p.discount), endsOn: p.endsOn, posterUrl: p.posterUrl, itemIds }] : []
    }),
  }
}
