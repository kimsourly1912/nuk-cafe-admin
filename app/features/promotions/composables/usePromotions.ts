import type { Page } from '#shared/contracts/common'
import type { MenuItemSummary } from '#shared/contracts/menu-items'
import type { CreatePromotionInput, Promotion, PromotionResults, UpdatePromotionInput } from '#shared/contracts/menu-promotions'
import { MAX_PAGE_SIZE } from '#shared/contracts/common'

const BASE = '/admin/menu/promotions'

/** Promotions change menu prices; nothing else in the admin shows them. */
const AFFECTED = ['promotions']

/** Every promotion: the library is small, so the page filters by phase and counts itself. */
export function usePromotionList() {
  return useApiQuery('promotions:list', () => apiFetch<Promotion[]>(BASE))
}

export const fetchPromotion = (id: string) => apiFetch<Promotion>(`${BASE}/${id}`)

export function usePromotion(id: string) {
  return useApiQuery(`promotions:promotion:${id}`, () => fetchPromotion(id))
}

export function usePromotionResults(id: string) {
  return useApiQuery(`promotions:results:${id}`, () => apiFetch<PromotionResults>(`${BASE}/${id}/results`))
}

/**
 * Every menu item that sells or could (drafts and published, not archived), for choosing what a
 * promotion covers: a page at a time until all are read (a cafe's menu is a few hundred items at
 * most). Refreshed with Menu items' changes too.
 */
export function usePromotionMenuItems() {
  return useApiQuery('promotions:menu-items', async () => {
    const items: MenuItemSummary[] = []
    for (let page = 1; ; page++) {
      const result = await apiFetch<Page<MenuItemSummary>>('/admin/menu/items', { query: { page, pageSize: MAX_PAGE_SIZE, status: 'all' } })
      items.push(...result.items)
      if (page >= result.totalPages) break
    }
    return items.filter(item => item.status !== 'archived')
  })
}

const promotionKey = (id: string) => `promotion:${id}`

/**
 * Promotion mutations. Every change to one promotion shares its key and lock: they run one at a
 * time, each naming the version the last one returned.
 */
export function usePromotionMutations() {
  const create = useMutation(
    (body: CreatePromotionInput) => apiFetch<Promotion>(BASE, { method: 'POST', body }),
    {
      id: 'promotions:create',
      key: body => body.name.toLowerCase(),
      successMessage: (_, body) => (body.publish ? `Promotion "${body.name}" published` : `Draft "${body.name}" saved`),
      errorMessage: body => `Could not save "${body.name}"`,
      invalidate: AFFECTED,
    },
  )

  const update = useMutation(
    ({ id, body }: { id: string, body: UpdatePromotionInput, wasDraft: boolean }) => apiFetch<Promotion>(`${BASE}/${id}`, { method: 'PUT', body }),
    {
      id: 'promotions:update',
      key: ({ id }) => promotionKey(id),
      lock: ({ id }) => promotionKey(id),
      successMessage: (_, { body, wasDraft }) => (wasDraft && body.publish ? `Promotion "${body.name}" published` : `"${body.name}" saved`),
      errorMessage: ({ body }) => `Could not save "${body.name}"`,
      invalidate: AFFECTED,
    },
  )

  const publish = useMutation(
    (promotion: Promotion) => apiFetch<Promotion>(`${BASE}/${promotion.id}/publish`, { method: 'POST', body: { version: promotion.version } }),
    {
      id: 'promotions:publish',
      key: p => promotionKey(p.id),
      lock: p => promotionKey(p.id),
      successMessage: (_, p) => `Promotion "${p.name}" published`,
      errorMessage: p => `Could not publish "${p.name}"`,
      invalidate: AFFECTED,
    },
  )

  const end = useMutation(
    (promotion: Promotion) => apiFetch<Promotion>(`${BASE}/${promotion.id}/end`, { method: 'POST', body: { version: promotion.version } }),
    {
      id: 'promotions:end',
      key: p => promotionKey(p.id),
      lock: p => promotionKey(p.id),
      confirm: p => ({
        title: `End “${p.name}” now?`,
        description: p.phase === 'live'
          ? 'Prices go back to normal on the menu at once. Orders already placed keep their discount. An ended promotion can\'t be restarted.'
          : 'It won\'t start. An ended promotion can\'t be restarted.',
        confirmLabel: 'End promotion',
        danger: true,
      }),
      successMessage: (_, p) => `Promotion "${p.name}" ended`,
      errorMessage: p => `Could not end "${p.name}"`,
      invalidate: AFFECTED,
    },
  )

  const remove = useMutation(
    (promotion: Promotion) => apiFetch<null>(`${BASE}/${promotion.id}`, { method: 'DELETE', body: { version: promotion.version } }),
    {
      id: 'promotions:delete',
      key: p => promotionKey(p.id),
      lock: p => promotionKey(p.id),
      removes: true,
      confirm: p => ({ title: `Delete the draft “${p.name}”?`, description: 'Customers never saw it. This can\'t be undone.', confirmLabel: 'Delete draft', danger: true }),
      successMessage: (_, p) => `Draft "${p.name}" deleted`,
      errorMessage: p => `Could not delete "${p.name}"`,
      invalidate: AFFECTED,
    },
  )

  const all = [update, publish, end, remove]
  return {
    create,
    update,
    publish,
    end,
    remove,
    /** Any change to this promotion in flight. */
    isBusy: (id: string) => all.some(m => m.isPending(promotionKey(id))),
  }
}
