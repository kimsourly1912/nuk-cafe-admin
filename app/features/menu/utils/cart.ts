import { LINE_MAX_QUANTITY, LINE_NOTE_MAX, ORDER_MAX_LINES } from '#shared/contracts/orders'
import type { PublicMenuItem } from '#shared/contracts/public-menu'

/**
 * The customer's order before checkout (D93): lines of one version with its add-ons, kept in this
 * browser only. Prices are never stored: a line is read against the current menu (`resolveCart`),
 * so a price change or a sold-out switch shows at once. Checkout (step 6.2) prices the order again
 * on the server; nothing here is authoritative.
 */

/** The most of one line an order may hold (checkout refuses more, D98). */
export const MAX_LINE_QUANTITY = LINE_MAX_QUANTITY

export interface CartLine {
  /** The version and add-ons: the same choice twice is one line with a larger quantity. */
  key: string
  itemId: string
  variationId: string
  /** In menu order. */
  modifierIds: string[]
  quantity: number
  /** The name when it was added, shown if the item has left the menu since. */
  name: string
  /** "Less ice": for the counter, at most `LINE_NOTE_MAX` characters (checkout, D100). */
  note?: string | null
}

export const lineKey = (variationId: string, modifierIds: string[]) => `${variationId}:${[...modifierIds].sort().join(',')}`

const clamp = (quantity: number) => Math.min(MAX_LINE_QUANTITY, Math.max(0, Math.floor(quantity)))

/** Whether another line can be added (an order holds at most `ORDER_MAX_LINES`, D98). */
export const canAddLine = (lines: CartLine[], line: Pick<CartLine, 'variationId' | 'modifierIds'>) =>
  lines.length < ORDER_MAX_LINES || lines.some(l => l.key === lineKey(line.variationId, line.modifierIds))

/** Adds a line, or more of the same choice to its line; a new line past the limit is ignored. */
export function addLine(lines: CartLine[], line: Omit<CartLine, 'key'>): CartLine[] {
  const key = lineKey(line.variationId, line.modifierIds)
  const existing = lines.find(l => l.key === key)
  if (existing) return setLineQuantity(lines, key, existing.quantity + line.quantity)
  if (!canAddLine(lines, line)) return lines
  const quantity = clamp(line.quantity)
  return quantity ? [...lines, { ...line, key, quantity }] : lines
}

/** A new quantity for a line; 0 removes it. */
export function setLineQuantity(lines: CartLine[], key: string, quantity: number): CartLine[] {
  const next = clamp(quantity)
  return next ? lines.map(l => (l.key === key ? { ...l, quantity: next } : l)) : lines.filter(l => l.key !== key)
}

/** A line's note (trimmed, at most `LINE_NOTE_MAX` characters; blank removes it). */
export function setLineNote(lines: CartLine[], key: string, note: string): CartLine[] {
  const value = note.slice(0, LINE_NOTE_MAX)
  return lines.map(l => (l.key === key ? { ...l, note: value.trim() ? value : null } : l))
}

/** How many of an item are in the order, over all its lines. */
export const quantityOfItem = (lines: CartLine[], itemId: string) =>
  lines.filter(l => l.itemId === itemId).reduce((sum, l) => sum + l.quantity, 0)

export interface ResolvedLine extends CartLine {
  /** "Large, Iced · Oat milk, Extra shot"; empty for an item with nothing chosen. */
  detail: string
  unitPriceMinor: number
  imageUrl: string | null
  /** Still on the menu, its version not sold out, its add-ons still offered. */
  available: boolean
}

export interface ResolvedCart {
  lines: ResolvedLine[]
  /** Units of the available lines. */
  count: number
  /** Of the available lines, in cents. */
  subtotalMinor: number
}

/** The lines as the current menu prices and names them; unavailable ones don't count. */
export function resolveCart(lines: CartLine[], items: PublicMenuItem[]): ResolvedCart {
  const byId = new Map(items.map(item => [item.id, item]))
  const resolved = lines.map((line): ResolvedLine => {
    const item = byId.get(line.itemId)
    const version = item?.variations.find(v => v.id === line.variationId)
    const offered = new Map(item?.modifierGroups.flatMap(g => g.modifiers).map(m => [m.id, m]) ?? [])
    const modifiers = line.modifierIds.map(id => offered.get(id))
    if (!item || !version || modifiers.some(m => !m)) {
      return { ...line, detail: '', unitPriceMinor: 0, imageUrl: null, available: false }
    }
    const chosen = modifiers.filter(m => m !== undefined)
    return {
      ...line,
      name: item.name,
      detail: [version.label, chosen.map(m => m.name).join(', ')].filter(Boolean).join(' · '),
      unitPriceMinor: version.priceMinor + chosen.reduce((sum, m) => sum + m.priceDeltaMinor, 0),
      imageUrl: item.imageUrl,
      available: !version.soldOut,
    }
  })
  const counted = resolved.filter(line => line.available)
  return {
    lines: resolved,
    count: counted.reduce((sum, line) => sum + line.quantity, 0),
    subtotalMinor: counted.reduce((sum, line) => sum + line.quantity * line.unitPriceMinor, 0),
  }
}

/** Lines read back from storage: anything malformed is dropped rather than trusted. */
export function parseLines(value: unknown): CartLine[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw): CartLine[] => {
    if (!raw || typeof raw !== 'object') return []
    const { itemId, variationId, modifierIds, quantity, name, note } = raw as Record<string, unknown>
    if (typeof itemId !== 'string' || typeof variationId !== 'string' || typeof name !== 'string') return []
    if (!Array.isArray(modifierIds) || !modifierIds.every(id => typeof id === 'string')) return []
    const count = typeof quantity === 'number' ? clamp(quantity) : 0
    if (!count) return []
    const kept = typeof note === 'string' && note.trim() ? note.slice(0, LINE_NOTE_MAX) : null
    return [{ key: lineKey(variationId, modifierIds), itemId, variationId, modifierIds, quantity: count, name, note: kept }]
  })
}

/** A line of an earlier order, as Order again reads it (step 6.5b, D114). */
export interface PastLine {
  itemId: string
  variationId: string
  modifierIds: string[]
  quantity: number
  note: string | null
  /** The name it was sold under, for "… isn't available now". */
  name: string
}

/**
 * Order again: the lines still on the menu as they were (the item, the same version not sold out,
 * every add-on still offered), with their notes, ready to add; the others are named as skipped.
 * Add-ons are put in menu order, like a line added from the menu.
 */
export function reorderLines(lines: PastLine[], items: PublicMenuItem[]): { lines: Omit<CartLine, 'key'>[], skipped: string[] } {
  const byId = new Map(items.map(item => [item.id, item]))
  const kept: Omit<CartLine, 'key'>[] = []
  const skipped: string[] = []
  for (const line of lines) {
    const item = byId.get(line.itemId)
    const version = item?.variations.find(v => v.id === line.variationId)
    const offered = item?.modifierGroups.flatMap(g => g.modifiers.map(m => m.id)) ?? []
    if (!item || !version || version.soldOut || !line.modifierIds.every(id => offered.includes(id))) {
      if (!skipped.includes(line.name)) skipped.push(line.name)
      continue
    }
    kept.push({
      itemId: item.id,
      variationId: version.id,
      modifierIds: offered.filter(id => line.modifierIds.includes(id)),
      quantity: line.quantity,
      name: item.name,
      note: line.note,
    })
  }
  return { lines: kept, skipped }
}
