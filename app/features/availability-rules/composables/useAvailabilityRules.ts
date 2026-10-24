import type { AvailabilityRule, CreateAvailabilityRuleInput, RuleDeleteBlocker, UpdateAvailabilityRuleInput } from '#shared/contracts/menu-availability'

const BASE = '/admin/menu/availability-rules'

/** Archive and restore of one rule never overlap with its edit: all take this record lock. */
const lockOf = (id: string) => `availability-rule:${id}`

/** Features whose data shows rule names (category and item forms, once they move to this API). */
const AFFECTED = ['availability-rules', 'categories', 'products']

/**
 * Items and categories use it: the server refuses to archive it (an archived rule never matches,
 * so they'd stop being sold, D63). The list disables Archive up front.
 */
export const inUse = (rule: AvailabilityRule) => rule.itemCount + rule.categoryCount > 0

/** "In use by 2 menu items and 1 category". */
export function usageLabel(rule: AvailabilityRule): string {
  const parts = [
    ...(rule.itemCount ? [pluralize(rule.itemCount, ['menu item', 'menu items'])] : []),
    ...(rule.categoryCount ? [pluralize(rule.categoryCount, ['category', 'categories'])] : []),
  ]
  return parts.length ? `In use by ${parts.join(' and ')}` : 'Not used yet'
}

/** Every rule, active and archived: the library is small, so the page filters and counts itself. */
export function useAvailabilityRuleList() {
  return useApiQuery('availability-rules:list', () => apiFetch<AvailabilityRule[]>(BASE, { query: { status: 'all' } }), { staleTime: REFERENCE_STALE_TIME })
}

/**
 * Rule mutations. State is shared app-wide by mutation id, so e.g. a card knows it's being saved
 * even after the edit modal was closed.
 */
export function useAvailabilityRuleMutations() {
  const create = useMutation(
    (body: CreateAvailabilityRuleInput) => apiFetch<AvailabilityRule>(BASE, { method: 'POST', body }),
    {
      id: 'availability-rules:create',
      // Same name in flight = same submission (double submit); different names run in parallel.
      key: body => body.name.toLowerCase(),
      successMessage: (_, body) => `Rule "${body.name}" created`,
      errorMessage: body => `Could not create "${body.name}"`,
      invalidate: AFFECTED,
    },
  )

  const update = useMutation(
    ({ id, body }: { id: string, name: string, body: UpdateAvailabilityRuleInput }) =>
      apiFetch<AvailabilityRule>(`${BASE}/${id}`, { method: 'PATCH', body }),
    {
      id: 'availability-rules:update',
      key: ({ id }) => id,
      lock: ({ id }) => lockOf(id),
      successMessage: (_, { name }) => `Rule "${name}" updated`,
      errorMessage: ({ name }) => `Could not save "${name}"`,
      invalidate: AFFECTED,
    },
  )

  const archive = useMutation(
    (rule: AvailabilityRule) => apiFetch<AvailabilityRule>(`${BASE}/${rule.id}/archive`, { method: 'POST', body: { version: rule.version } }),
    {
      id: 'availability-rules:archive',
      key: rule => rule.id,
      lock: rule => lockOf(rule.id),
      // Undo instead of asking (D152).
      undo: ([done]) => void (done && restore.execute(done.data)),
      successMessage: (_, rule) => `Rule "${rule.name}" archived`,
      errorMessage: rule => `Could not archive "${rule.name}"`,
      invalidate: AFFECTED,
    },
  )

  const restore = useMutation(
    (rule: AvailabilityRule) => apiFetch<AvailabilityRule>(`${BASE}/${rule.id}/restore`, { method: 'POST', body: { version: rule.version } }),
    {
      id: 'availability-rules:restore',
      key: rule => rule.id,
      lock: rule => lockOf(rule.id),
      successMessage: (_, rule) => `Rule "${rule.name}" restored`,
      errorMessage: rule => `Could not restore "${rule.name}"`,
      invalidate: AFFECTED,
    },
  )

  /**
   * Deletes an archived rule nothing uses for good (D200). Asks first: it can't be restored. The
   * server refuses one items or categories still name (409 `AVAILABILITY_RULE_HAS_USES`).
   */
  const remove = useMutation(
    (rule: AvailabilityRule) => apiFetch<null>(`${BASE}/${rule.id}`, { method: 'DELETE', query: { version: rule.version } }),
    {
      id: 'availability-rules:delete',
      key: rule => rule.id,
      lock: rule => lockOf(rule.id),
      removes: true,
      confirm: rule => ({
        title: `Delete "${rule.name}" permanently?`,
        description: 'No menu item or category uses it. Its times are removed too, and it can\'t be restored.',
        confirmLabel: 'Delete permanently',
        danger: true,
      }),
      successMessage: (_, rule) => `Rule "${rule.name}" deleted`,
      errorMessage: rule => `Could not delete "${rule.name}"`,
      invalidate: AFFECTED,
    },
  )

  return {
    create,
    update,
    archive,
    restore,
    remove,
    /** Any operation in flight for this rule: disable its card actions. */
    isBusy: (id: string) => update.isPending(id) || archive.isPending(id) || restore.isPending(id) || remove.isPending(id),
  }
}

/** Why Delete permanently is off for an archived rule (D200), under the action. */
export const DELETE_BLOCKED: Record<RuleDeleteBlocker, string> = {
  items: 'Menu items still use it (archived ones too)',
  categories: 'Categories still use it (archived ones too)',
}
