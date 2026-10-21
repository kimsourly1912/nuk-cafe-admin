import * as v from 'valibot'
import type { CreatePromotionInput, Discount, Promotion, PromotionPhase } from '#shared/contracts/menu-promotions'
import { PROMOTION_DESCRIPTION_MAX, PROMOTION_NAME_MAX, PROMOTION_TARGETS_MAX } from '#shared/contracts/menu-promotions'
import { fromMinor, toMinor } from '~/utils/money'
import { previewList } from '~/utils/text'

/**
 * The promotion editor's draft and wording (M1, D163). Pure, so the rules and the words are
 * unit-tested once. Money is dollars in the form, cents in the API.
 */

export interface PromotionForm {
  name: string
  description: string
  kind: 'percent' | 'amount'
  /** 1–100, for a percent off. */
  percent?: number
  /** Dollars, for an amount off. */
  amount?: number
  scope: 'menu' | 'selected'
  itemIds: string[]
  categoryIds: string[]
  allBranches: boolean
  branchIds: string[]
  /** `YYYY-MM-DD`. */
  startsOn: string
  /** `YYYY-MM-DD`; `null`: until ended. */
  endsOn: string | null
  posterId?: string
  posterUrl?: string
}

export const promotionFormSchema = v.pipe(
  v.object({
    name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Name is required'), v.maxLength(PROMOTION_NAME_MAX, `At most ${PROMOTION_NAME_MAX} characters`)),
    description: v.pipe(v.string(), v.maxLength(PROMOTION_DESCRIPTION_MAX, `At most ${PROMOTION_DESCRIPTION_MAX} characters`)),
    kind: v.picklist(['percent', 'amount']),
    percent: v.optional(v.number()),
    amount: v.optional(v.number()),
    scope: v.picklist(['menu', 'selected']),
    itemIds: v.array(v.string()),
    categoryIds: v.array(v.string()),
    allBranches: v.boolean(),
    branchIds: v.array(v.string()),
    startsOn: v.string(),
    endsOn: v.nullable(v.string()),
    posterId: v.optional(v.string()),
    posterUrl: v.optional(v.string()),
  }),
  v.forward(v.partialCheck([['kind'], ['percent']], f => f.kind !== 'percent' || (f.percent !== undefined && Number.isInteger(f.percent) && f.percent >= 1 && f.percent <= 100), 'Enter a whole number from 1 to 100'), ['percent']),
  v.forward(v.partialCheck([['kind'], ['amount']], f => f.kind !== 'amount' || (f.amount !== undefined && toMinor(f.amount) >= 1 && f.amount <= 1000), 'Enter an amount from $0.01 to $1,000'), ['amount']),
  v.forward(v.partialCheck([['scope'], ['itemIds'], ['categoryIds']], f => f.scope === 'menu' || f.itemIds.length + f.categoryIds.length > 0, 'Choose at least one item or category'), ['itemIds']),
  v.forward(v.partialCheck([['scope'], ['itemIds'], ['categoryIds']], f => f.scope === 'menu' || f.itemIds.length + f.categoryIds.length <= PROMOTION_TARGETS_MAX, `At most ${PROMOTION_TARGETS_MAX} items and categories`), ['itemIds']),
  v.forward(v.partialCheck([['allBranches'], ['branchIds']], f => f.allBranches || f.branchIds.length > 0, 'Choose at least one branch'), ['branchIds']),
  v.forward(v.partialCheck([['startsOn']], f => /^\d{4}-\d{2}-\d{2}$/.test(f.startsOn), 'Choose the first day'), ['startsOn']),
  v.forward(v.partialCheck([['startsOn'], ['endsOn']], f => f.endsOn === null || f.endsOn >= f.startsOn, 'The last day can\'t be before the first'), ['endsOn']),
)

/** A new promotion: 10% off chosen items, from `today` for a week, at every branch. */
export function newPromotionForm(today: string): PromotionForm {
  return { name: '', description: '', kind: 'percent', percent: 10, scope: 'selected', itemIds: [], categoryIds: [], allBranches: true, branchIds: [], startsOn: today, endsOn: addDays(today, 6) }
}

export function toPromotionForm(promotion: Promotion): PromotionForm {
  return {
    name: promotion.name,
    description: promotion.description,
    kind: promotion.discount.kind,
    percent: promotion.discount.kind === 'percent' ? promotion.discount.percent : undefined,
    amount: promotion.discount.kind === 'amount' ? fromMinor(promotion.discount.amountMinor) : undefined,
    scope: promotion.scope,
    itemIds: promotion.items.map(i => i.id),
    categoryIds: promotion.categories.map(c => c.id),
    allBranches: promotion.branches.length === 0,
    branchIds: promotion.branches.map(b => b.id),
    startsOn: promotion.startsOn,
    endsOn: promotion.endsOn,
    posterId: promotion.poster?.id,
    posterUrl: promotion.poster?.url,
  }
}

export function formDiscount(form: Pick<PromotionForm, 'kind' | 'percent' | 'amount'>): Discount | null {
  if (form.kind === 'percent') return form.percent ? { kind: 'percent', percent: form.percent } : null
  return form.amount ? { kind: 'amount', amountMinor: toMinor(form.amount) } : null
}

/** What the editor saves (the whole promotion), without `publish`. */
export function toPromotionBody(form: PromotionForm): Omit<CreatePromotionInput, 'publish'> {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    discount: formDiscount(form)!,
    scope: form.scope,
    itemIds: form.scope === 'menu' ? [] : form.itemIds,
    categoryIds: form.scope === 'menu' ? [] : form.categoryIds,
    branchIds: form.allBranches ? [] : form.branchIds,
    startsOn: form.startsOn,
    endsOn: form.endsOn,
    posterId: form.posterId ?? null,
  }
}

// --- Dates ---

/** `YYYY-MM-DD` plus `days`. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Whole days from `from` to `to` (`YYYY-MM-DD` both). */
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

/** This browser's calendar date, `YYYY-MM-DD`. */
// eslint-disable-next-line no-restricted-syntax -- a `YYYY-MM-DD` key (en-CA writes it that way), never shown
export const localToday = (now = new Date()) => now.toLocaleDateString('en-CA')

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const parts = (date: string) => ({ year: Number(date.slice(0, 4)), month: MONTHS[Number(date.slice(5, 7)) - 1]!, day: Number(date.slice(8, 10)) })

/** "15 Oct 2026". */
export function dateText(date: string): string {
  const { year, month, day } = parts(date)
  return `${day} ${month} ${year}`
}

/** "15 – 21 Oct 2026", "28 Oct – 3 Nov 2026", "28 Dec 2026 – 3 Jan 2027", "15 Oct 2026" or "From 15 Oct 2026". */
export function whenText(startsOn: string, endsOn: string | null): string {
  if (endsOn === null) return `From ${dateText(startsOn)}`
  if (endsOn === startsOn) return dateText(startsOn)
  const a = parts(startsOn)
  const b = parts(endsOn)
  if (a.year !== b.year) return `${dateText(startsOn)} – ${dateText(endsOn)}`
  if (a.month !== b.month) return `${a.day} ${a.month} – ${dateText(endsOn)}`
  return `${a.day} – ${dateText(endsOn)}`
}

/** The line under a promotion's name: when it starts or ends, from the admin's `today`. */
export function timingText(promotion: Pick<Promotion, 'phase' | 'startsOn' | 'endsOn' | 'endedAt'>, today: string): string {
  if (promotion.phase === 'scheduled') {
    const days = daysBetween(today, promotion.startsOn)
    return days === 1 ? 'Starts tomorrow' : `Starts in ${days} days`
  }
  if (promotion.phase === 'live') {
    if (promotion.endsOn === null) return 'Runs until you end it'
    const days = daysBetween(today, promotion.endsOn)
    return days <= 0 ? 'Last day today' : days === 1 ? 'Ends tomorrow' : `Ends in ${days} days`
  }
  if (promotion.phase === 'ended') return promotion.endedAt ? `Ended by hand on ${dateText(promotion.endedAt.slice(0, 10))}` : 'Ended'
  return 'Not published'
}

// --- Words ---

export const PHASES: Record<PromotionPhase, { label: string, color: 'success' | 'info' | 'neutral', variant: 'subtle' | 'outline' }> = {
  live: { label: 'Live', color: 'success', variant: 'subtle' },
  scheduled: { label: 'Scheduled', color: 'info', variant: 'subtle' },
  draft: { label: 'Draft', color: 'neutral', variant: 'subtle' },
  ended: { label: 'Ended', color: 'neutral', variant: 'outline' },
}

/** "Whole menu", "Coffee, Tea and 2 more", "Nothing chosen". */
export function targetsText(promotion: Pick<Promotion, 'scope' | 'items' | 'categories'>): string {
  if (promotion.scope === 'menu') return 'Whole menu'
  const names = [...promotion.categories.map(c => c.name), ...promotion.items.map(i => i.name)]
  return names.length ? previewList(names, 3) : 'Nothing chosen'
}

/**
 * Other promotions that run alongside: scheduled or live, and covering one of the same items
 * (`categoryOf`: an item's category and its parent). Customers get the bigger discount; the editor
 * says so.
 */
export function overlapping(form: Pick<PromotionForm, 'scope' | 'itemIds' | 'categoryIds'>, others: Promotion[], categoryOf: (itemId: string) => string[]): Promotion[] {
  const running = others.filter(p => p.phase === 'live' || p.phase === 'scheduled')
  if (form.scope === 'menu') return running
  const covers = (p: Promotion, itemId: string) => p.scope === 'menu' || p.items.some(i => i.id === itemId) || categoryOf(itemId).some(id => p.categories.some(c => c.id === id))
  return running.filter(p => p.scope === 'menu'
    || form.itemIds.some(id => covers(p, id))
    || form.categoryIds.some(id => p.categories.some(c => c.id === id) || p.items.some(i => categoryOf(i.id).includes(id))))
}

// --- Choosing what's included ---

export interface PickerCategory {
  id: string
  name: string
  /** Its items, or (a main category) its sub-categories'. */
  items: { id: string, name: string, draft: boolean, priceMinMinor: number | null }[]
  subs: PickerCategory[]
}

/**
 * The menu as the "Choose what's included" list shows it: active main categories in menu order,
 * each with its active sub-categories or its items (drafts marked; archived items left out).
 */
export function pickerTree(
  categories: { id: string, parentId: string | null, name: string, status: string, sortOrder: number }[],
  items: { id: string, categoryId: string, name: string, status: string, sortOrder: number, priceMinMinor: number | null }[],
): PickerCategory[] {
  const order = <T extends { sortOrder: number, name: string }>(list: T[]) => [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
  const active = categories.filter(c => c.status === 'active')
  const itemsOf = (categoryId: string) => order(items.filter(i => i.categoryId === categoryId && i.status !== 'archived'))
    .map(i => ({ id: i.id, name: i.name, draft: i.status === 'draft', priceMinMinor: i.priceMinMinor }))
  return order(active.filter(c => c.parentId === null)).map(main => ({
    id: main.id,
    name: main.name,
    items: itemsOf(main.id),
    subs: order(active.filter(c => c.parentId === main.id)).map(sub => ({ id: sub.id, name: sub.name, items: itemsOf(sub.id), subs: [] })),
  }))
}

/** An item's category and that category's parent: what a promotion on a category covers. */
export function categoryPath(categories: { id: string, parentId: string | null }[], items: { id: string, categoryId: string }[]) {
  const parent = new Map(categories.map(c => [c.id, c.parentId]))
  const category = new Map(items.map(i => [i.id, i.categoryId]))
  return (itemId: string): string[] => {
    const own = category.get(itemId)
    if (!own) return []
    const up = parent.get(own)
    return up ? [own, up] : [own]
  }
}
