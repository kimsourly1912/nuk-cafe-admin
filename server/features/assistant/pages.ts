import type { AssistantPageLink } from '#shared/contracts/assistant'

/**
 * The pages the assistant may link to (step 9.1, D109): the admin portal's fixed routes and the
 * counter app. `link_to_page` takes one of these keys, so the model can't invent a path. A page
 * with a record in its path (`/admin/add-ons/<id>`) isn't here: the answer names the list instead.
 */
export const ASSISTANT_PAGES = {
  'dashboard': { title: 'Dashboard', path: '/admin' },
  'menu-items': { title: 'Menu items', path: '/admin/products' },
  'new-menu-item': { title: 'New menu item', path: '/admin/products/new' },
  'categories': { title: 'Categories', path: '/admin/categories' },
  'options': { title: 'Options', path: '/admin/options' },
  'add-ons': { title: 'Add-ons', path: '/admin/add-ons' },
  'availability': { title: 'Availability', path: '/admin/availability' },
  'staff': { title: 'Staff', path: '/admin/staff' },
  'branch': { title: 'Branch', path: '/admin/branches' },
  'payments': { title: 'Payments', path: '/admin/payments' },
  'telegram': { title: 'Telegram', path: '/admin/telegram' },
  'reports-summary': { title: 'Summary', path: '/admin/reports/summary' },
  'reports-items': { title: 'Sales by item', path: '/admin/reports/items' },
  'reports-orders': { title: 'Order history', path: '/admin/reports/orders' },
  'sample-data': { title: 'Sample data', path: '/admin/sample-data' },
  'change-password': { title: 'Change password', path: '/admin/change-password' },
  'counter': { title: 'Counter app', path: '/counter' },
} as const satisfies Record<string, AssistantPageLink>

export type AssistantPageKey = keyof typeof ASSISTANT_PAGES

export interface PageOptions {
  /** Sample data exists only where the environment turns it on (D94). */
  sampleData: boolean
}

/** The keys the model may use here. */
export function pageKeys(options: PageOptions): AssistantPageKey[] {
  return (Object.keys(ASSISTANT_PAGES) as AssistantPageKey[]).filter(key => key !== 'sample-data' || options.sampleData)
}

/** The page an admin path belongs to (the longest matching path), for "the admin is on …". */
export function pageAt(path: string): AssistantPageLink | null {
  const bare = path.split(/[?#]/)[0]!.replace(/\/+$/, '') || '/'
  let best: AssistantPageLink | null = null
  for (const page of Object.values(ASSISTANT_PAGES)) {
    const matches = bare === page.path || bare.startsWith(`${page.path}/`)
    if (matches && (!best || page.path.length > best.path.length)) best = page
  }
  return best
}
