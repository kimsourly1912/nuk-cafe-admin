import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Deny by default (docs/server/security.md → Checking). The route rules only ask for a session on
// `/api/admin/**`: who may use the admin is a role in the tenant, which they can't see (D135). So
// every admin route must call an access helper that checks it; this finds one that forgot.
const ACCESS_HELPERS = ['requirePermission(', 'requireSampleData(', 'requireAssistant(', 'adminSession(']

const adminDir = fileURLToPath(new URL('../api/admin', import.meta.url))
const routeFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? routeFiles(join(dir, entry.name)) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : [])

describe('admin routes', () => {
  const files = routeFiles(adminDir)

  it('are found', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it.each(files.map(file => [file.slice(adminDir.length + 1), file]))('%s checks access', (_name, file) => {
    const source = readFileSync(file, 'utf8')
    expect(ACCESS_HELPERS.some(helper => source.includes(helper))).toBe(true)
  })
})
