import type { SelectItem } from '@nuxt/ui'

/** ACTIVE/INACTIVE status used by most backend resources. */
export type Status = 'ACTIVE' | 'INACTIVE'

export const STATUS_LABELS: Record<Status, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
}

/** Options for a status field in forms. */
export const STATUS_ITEMS: SelectItem[] = [
  { label: STATUS_LABELS.ACTIVE, value: 'ACTIVE' },
  { label: STATUS_LABELS.INACTIVE, value: 'INACTIVE' },
]

/** Options for a status filter in list toolbars (includes "All"). */
export const STATUS_FILTER_ITEMS: SelectItem[] = [
  { label: 'All statuses', value: ANY },
  ...STATUS_ITEMS,
]
