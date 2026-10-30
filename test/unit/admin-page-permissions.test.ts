import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { TenantPermission } from '../../server/features/identity/identity.permissions'
import { tenantRoles, tenantStatements } from '../../server/features/identity/identity.permissions'
import { supportPermissionList } from '../../server/features/support/support.rules'
import { allowedNavigation } from '../../app/utils/navigation-access'

// Page-level access in the admin (D240): every page names the permission its main read asks the
// server for, the route middleware refuses a session without it, and the sidebar leaves it out.

const ADMIN_PAGES = join(import.meta.dirname, '../../app/pages/c/[slug]/admin')
/** Pages every admin session opens: sign-in, the temporary-password page, Overview, and a redirect. */
const OPEN_TO_EVERY_SESSION = ['login.vue', 'change-password.vue', 'index.vue', 'reports/index.vue']

function pageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? pageFiles(join(dir, entry.name)) : entry.name.endsWith('.vue') ? [join(dir, entry.name)] : [])
}

/** Each page's `permission` meta, by its path under `admin/`. */
const pagePermissions = Object.fromEntries(pageFiles(ADMIN_PAGES).map(file => [
  relative(ADMIN_PAGES, file),
  /definePageMeta\(\{[^)]*permission: '([^']+)'/.exec(readFileSync(file, 'utf8'))?.[1],
]))

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
