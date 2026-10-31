import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BranchPermission, TenantPermission } from '../../server/features/identity/identity.permissions'
import { branchRoles, branchStatements, tenantRoles, tenantStatements } from '../../server/features/identity/identity.permissions'
import { supportPermissionList } from '../../server/features/support/support.rules'
import { allowedNavigation } from '../../app/utils/navigation-access'

// Page-level access (D240): every admin page names the permission its main read asks the server for,
// every counter branch page its branch permission; the route middleware refuses a session without
// it, and the sidebar or the counter's Manage menu leaves it out.

const ADMIN_PAGES = join(import.meta.dirname, '../../app/pages/c/[slug]/admin')
const BRANCH_PAGES = join(import.meta.dirname, '../../app/pages/c/[slug]/counter/[branchId]')
/**
 * Pages every admin session opens: sign-in, the temporary-password page, one's own account security
 * (D242), Overview, and a redirect.
 */
const OPEN_TO_EVERY_SESSION = ['login.vue', 'change-password.vue', 'account-security.vue', 'index.vue', 'reports/index.vue']

function pageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? pageFiles(join(dir, entry.name)) : entry.name.endsWith('.vue') ? [join(dir, entry.name)] : [])
}

/** Each page's `permission` (or `branchPermission`) meta, by its path under `dir`. */
function metaOf(dir: string, key: 'permission' | 'branchPermission'): Record<string, string | undefined> {
  return Object.fromEntries(pageFiles(dir).map(file => [
    relative(dir, file),
    new RegExp(`definePageMeta\\(\\{[^)]*\\b${key}: '([^']+)'`).exec(readFileSync(file, 'utf8'))?.[1],
  ]))
}

const pagePermissions = metaOf(ADMIN_PAGES, 'permission')
const branchPagePermissions = metaOf(BRANCH_PAGES, 'branchPermission')

const ownerGrants = (permission: string) => {
  const [resource, action] = permission.split(':')
  return tenantRoles.owner.authorize({ [resource!]: [action!] } as TenantPermission).success
}

describe('admin pages', () => {
  it('each name a permission, except the few every admin session opens', () => {
    const missing = Object.entries(pagePermissions).filter(([page, permission]) => !permission && !OPEN_TO_EVERY_SESSION.includes(page))
    expect(missing).toEqual([])
  })

  it('name only real tenant permissions, all of which an owner has', () => {
    const known = new Set(Object.entries(tenantStatements).flatMap(([resource, actions]) => actions.map(action => `${resource}:${action}`)))
    for (const permission of Object.values(pagePermissions).filter(Boolean)) {
      expect(known, permission).toContain(permission)
      expect(ownerGrants(permission!), permission).toBe(true)
    }
  })

  it('refuse a support visit only Platform support and Sample data', () => {
    const support = new Set(supportPermissionList())
    const refused = Object.entries(pagePermissions).filter(([, permission]) => permission && !support.has(permission)).map(([page]) => page)
    expect(refused.sort()).toEqual(['sample-data/index.vue', 'support/index.vue'])
  })
})

describe('counter branch pages', () => {
  const statement = (permission: string) => {
    const [resource, action] = permission.split(':')
    return { [resource!]: [action!] } as BranchPermission
  }

  it('each name a branch permission, except the Reports redirect', () => {
    const missing = Object.entries(branchPagePermissions).filter(([page, permission]) => !permission && page !== 'reports/index.vue')
    expect(missing).toEqual([])
  })

  it('name only real branch permissions', () => {
    const known = new Set(Object.entries(branchStatements).flatMap(([resource, actions]) => actions.map(action => `${resource}:${action}`)))
    for (const permission of Object.values(branchPagePermissions).filter(Boolean)) expect(known, permission).toContain(permission)
  })

  it('open every page to a manager and refuse staff only Dining tables and Reports (D198)', () => {
    const refused = (role: keyof typeof branchRoles) => Object.entries(branchPagePermissions)
      .filter(([, permission]) => permission && !branchRoles[role].authorize(statement(permission)).success)
      .map(([page]) => page)
      .sort()
    expect(refused('manager')).toEqual([])
    expect(refused('staff')).toEqual(['reports/items.vue', 'reports/orders.vue', 'reports/summary.vue', 'tables.vue'])
  })
})

describe('allowedNavigation', () => {
  const groups = [
    [{ label: 'Overview', to: '/admin' }],
    [{ label: 'Menu', type: 'label' as const }, { label: 'Menu items', to: '/admin/products' }],
    [{ label: 'Admin', type: 'label' as const }, { label: 'Staff', to: '/admin/staff' }, { label: 'Platform support', to: '/admin/support' }],
  ]

  it('leaves out the pages the session may not open', () => {
    const items = allowedNavigation(groups, to => to !== '/admin/support').flat().map(item => item.label)
    expect(items).toEqual(['Overview', 'Menu', 'Menu items', 'Admin', 'Staff'])
  })

  it('drops a group left with only its label', () => {
    const items = allowedNavigation(groups, to => to === '/admin' || to === '/admin/products').flat().map(item => item.label)
    expect(items).toEqual(['Overview', 'Menu', 'Menu items'])
  })
})
