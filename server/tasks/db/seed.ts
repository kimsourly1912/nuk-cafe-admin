import { seedDemoBranch } from '#server/features/branches'
import { seedFirstOwner, seedTenant } from '#server/features/identity'

/**
 * The cafe (a tenant, D134), its first owner and a demo branch. Locally, with the dev server running:
 * `curl http://localhost:3000/_nitro/tasks/db:seed`
 * (docs/server/operations.md → Seed data). Safe to repeat: each part is skipped once it exists.
 * The temporary password is printed once; the admin changes it at first sign-in.
 */
export default defineTask({
  meta: { name: 'db:seed', description: 'Create the cafe, its first owner and a demo branch when missing' },
  async run() {
    const config = useRuntimeConfig()
    const email = config.seed.adminEmail
    if (!email) throw new Error('Set NUXT_SEED_ADMIN_EMAIL to the first admin\'s email address.')
    const db = useDb()

    const tenant = await seedTenant(db, { name: 'NUK Cafe', slug: 'nuk' })
    const admin = await seedFirstOwner(db, tenant.id, { email, name: config.seed.adminName || 'Admin' })
    const branch = await seedDemoBranch(db, tenant.id, { timezone: config.public.cafeTimeZone })

    return {
      result: {
        tenant: tenant.created ? { name: tenant.name, slug: tenant.slug } : `existing: ${tenant.name}`,
        admin: admin
          ? { email: admin.staff.email, temporaryPassword: admin.temporaryPassword ?? '(existing account: its own password)' }
          : 'skipped: the cafe already has an owner',
        branch: branch ?? 'skipped: a branch already exists',
      },
    }
  },
})
