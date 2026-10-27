import { listBranchOptions, seedDemoBranch } from '#server/features/branches'
import { DEV_PASSWORD, resetDevAccount } from '#server/features/identity'
import type { DevAccountSpec } from '#server/features/identity'
import { seedTenant } from '#server/features/tenants'
import type { Db } from '#server/utils/batch'

/**
 * Test accounts, one per role, all with one password (docs/reference/auth.md → Test accounts, D209).
 * Dev server only: `pnpm dev:accounts` runs it and writes `dev-accounts.local.md`. Every run puts
 * them back: password, role, no forced change, no two-step sign-in, not banned, signed out.
 */

async function cafeWithBranch(db: Db, cafe: { id: string, name: string, slug: string }, timezone: string) {
  const branch = await seedDemoBranch(db, cafe.id, { timezone }) ?? (await listBranchOptions(db, cafe.id))[0]
  if (!branch) throw new Error(`${cafe.name} has no active branch.`)
  return { ...cafe, branch }
}

export default defineTask({
  meta: { name: 'dev:accounts', description: 'Create or reset the dev server\'s test accounts' },
  async run() {
    if (!import.meta.dev) throw new Error('Test accounts exist on the dev server only.')
    const config = useRuntimeConfig()
    const password = config.devAccounts.password || DEV_PASSWORD
    const timezone = config.public.cafeTimeZone
    const db = useDb()

    const nuk = await cafeWithBranch(db, await seedTenant(db, { name: 'NUK Cafe', slug: 'nuk' }), timezone)
    // A second cafe, to see by hand that one cafe's people can't reach the other's data.
    const second = await cafeWithBranch(db, await seedTenant(db, { name: 'Second Cafe', slug: 'second' }), timezone)

    const specs: (DevAccountSpec & { signIn: string })[] = [
      { email: 'superadmin@nuk.test', name: 'Super Admin', role: 'superadmin', signIn: '/platform/sign-in' },
      { email: 'owner@nuk.test', name: 'NUK Owner', role: 'owner', tenantId: nuk.id, signIn: `/c/${nuk.slug}/admin/login` },
      { email: 'manager@nuk.test', name: 'NUK Manager', role: 'manager', tenantId: nuk.id, branchId: nuk.branch.id, signIn: `/c/${nuk.slug}/counter/sign-in` },
      { email: 'staff@nuk.test', name: 'NUK Staff', role: 'staff', tenantId: nuk.id, branchId: nuk.branch.id, signIn: `/c/${nuk.slug}/counter/sign-in` },
      { email: 'customer@nuk.test', name: 'NUK Customer', role: 'customer', tenantId: nuk.id, signIn: '/sign-in' },
      { email: 'owner@second.test', name: 'Second Owner', role: 'owner', tenantId: second.id, signIn: `/c/${second.slug}/admin/login` },
    ]
    const accounts = []
    for (const { signIn, ...spec } of specs) {
      const account = await resetDevAccount(db, spec, { dev: import.meta.dev, password })
      const cafe = [nuk, second].find(c => c.id === spec.tenantId)
      accounts.push({ email: account.email, role: spec.role, cafe: cafe?.name ?? null, branch: spec.branchId ? cafe?.branch.name ?? null : null, signIn, created: account.created })
    }

    return { result: { password, accounts } }
  },
})
