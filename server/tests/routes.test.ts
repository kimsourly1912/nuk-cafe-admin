import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Deny by default (docs/server/security.md → Checking). The route rules only ask for a session on
// a cafe's `admin/**`: who may use the admin is a role in the tenant, which they can't see (D135).
// So every admin route must call an access helper that checks it; this finds one that forgot.
const ADMIN_HELPERS = ['requirePermission(', 'requireSampleData(', 'requireAssistant(', 'adminSession(']
// A cafe's address names its tenant (D140): every route under `/api/c/<slug>/` resolves it through
// `requireTenant` or a helper that calls it. A route that skipped it would ignore the address.
const TENANT_HELPERS = ['requireTenant(', 'requirePermission(', 'requireBranchPermission(', 'requireCustomer(', 'requireSignedIn(', 'requireSampleData(', 'requireAssistant(']

// The platform console (D142): every route checks the platform role; none acts in a cafe.
const PLATFORM_HELPERS = ['requirePlatformPermission(', 'platformSession(']

const apiDir = fileURLToPath(new URL('../api', import.meta.url))
const cafeDir = join(apiDir, 'c', '[slug]')
const platformDir = join(apiDir, 'platform')
const adminDir = join(cafeDir, 'admin')
const routeFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? routeFiles(join(dir, entry.name)) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : [])
const calls = (file: string, helpers: string[]) => {
  const source = readFileSync(file, 'utf8')
  return helpers.some(helper => source.includes(helper))
}

describe('admin routes', () => {
  const files = routeFiles(adminDir)

  it('are found', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it.each(files.map(file => [file.slice(adminDir.length + 1), file]))('%s checks access', (_name, file) => {
    expect(calls(file, ADMIN_HELPERS)).toBe(true)
  })
})

describe('cafe routes (D140)', () => {
  const files = routeFiles(cafeDir)

  it('are every admin, counter, shop and public route', () => {
    expect(readdirSync(cafeDir).sort()).toEqual(['admin', 'counter', 'public', 'shop'])
    expect(files.length).toBeGreaterThan(70)
  })

  it.each(files.map(file => [file.slice(cafeDir.length + 1), file]))('%s resolves the cafe from its address', (_name, file) => {
    expect(calls(file, TENANT_HELPERS)).toBe(true)
  })

  it('routes outside a cafe\'s address never act in one', () => {
    const global = routeFiles(apiDir).filter(file => !file.startsWith(cafeDir) && !file.startsWith(platformDir))
    // Forward slashes on every OS: Windows paths use `\`.
    expect(global.map(file => file.slice(apiDir.length + 1).replaceAll('\\', '/')).sort()).toEqual(['[...].ts', 'cafes/[slug].get.ts', 'client-errors.post.ts', 'health.get.ts', 'me/cafes.get.ts', 'tables/[token].get.ts', 'webhooks/telegram.post.ts'])
    expect(global.filter(file => calls(file, TENANT_HELPERS))).toEqual([])
  })
})

// The counter (D101, D198): a branch's routes check the caller's role at the branch in the path,
// never a tenant-wide permission (which members don't have, and which would ignore the branch).
describe('counter routes', () => {
  const branchDir = join(cafeDir, 'counter', '[branchId]')
  const files = routeFiles(branchDir)
  const name = (file: string) => file.slice(branchDir.length + 1).replaceAll('\\', '/')

  it.each(files.map(file => [name(file), file]))('%s checks the role at the path\'s branch', (_name, file) => {
    expect(calls(file, ['requireBranchPermission('])).toBe(true)
    expect(calls(file, ['requirePermission('])).toBe(false)
  })

  it('give managers their tools with their own permissions, and the branch from the path (D198)', () => {
    const tools = files.filter(file => /^(tables|reports)\//.test(name(file)))
    expect(tools.map(name).sort()).toEqual([
      'reports/branches.get.ts', 'reports/items.get.ts', 'reports/orders/[orderId].get.ts', 'reports/orders/index.get.ts', 'reports/summary.get.ts',
      'tables/[tableId].patch.ts', 'tables/[tableId]/archive.post.ts', 'tables/[tableId]/restore.post.ts', 'tables/[tableId]/rotate-qr.post.ts', 'tables/index.get.ts', 'tables/index.post.ts',
    ])
    for (const file of tools) {
      const source = readFileSync(file, 'utf8')
      const reports = name(file).startsWith('reports/')
      expect(source.includes(reports ? '{ report: [\'read\'] }' : '{ table: [')).toBe(true)
      // A report query's branch is the path's, whatever the query says; a detail is scoped to it.
      if (reports && name(file) !== 'reports/branches.get.ts') expect(source.includes('{ branchId }')).toBe(true)
    }
  })
})

describe('platform routes (D142)', () => {
  const files = routeFiles(platformDir)

  it('are found', () => {
    expect(files.length).toBeGreaterThanOrEqual(7)
  })

  it.each(files.map(file => [file.slice(platformDir.length + 1), file]))('%s checks the platform role and acts in no cafe', (_name, file) => {
    expect(calls(file, PLATFORM_HELPERS)).toBe(true)
    expect(calls(file, TENANT_HELPERS)).toBe(false)
  })
})

// Nitro 2 on Cloudflare Workers forwards a request body only for POST, PUT and PATCH
// (`requestHasBody`), so a DELETE's body is empty on staging and production while Node keeps it:
// a delete read its version from the body and failed only when deployed (D200). Deletes name
// their version in the query.
describe('DELETE routes (D200)', () => {
  const deletes = routeFiles(apiDir).filter(file => file.endsWith('.delete.ts'))

  it('are found', () => {
    expect(deletes.length).toBeGreaterThan(5)
  })

  it.each(deletes.map(file => [file.slice(apiDir.length + 1), file]))('%s reads no body', (_name, file) => {
    const source = readFileSync(file, 'utf8')
    expect(source).not.toMatch(/readValidBody|readBody|readRawBody|readLimitedBody|readMultipart/)
  })
})
