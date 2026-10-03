import { seedDemoBranch } from '#server/features/branches'
import { seedFirstOwner, seedSuperadmin } from '#server/features/identity'
import { seedTenant } from '#server/features/tenants'

/**
 * The cafe (a tenant, D134), its first owner and a demo branch. Locally, with the dev server running:
 * `curl http://localhost:3000/_nitro/tasks/db:seed`
 * (docs/server/operations.md → Seed data). Safe to repeat: each part is skipped once it exists.
 * The temporary password is printed once; the admin changes it at first sign-in. The first owner
 * is also a super admin, so the platform console (`/platform`, D142) can be tried locally.
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
    if (admin) await seedSuperadmin(db, admin.staff.id)
    const branch = await seedDemoBranch(db, tenant.id, { timezone: config.public.cafeTimeZone })

    return {
      result: {
        tenant: tenant.created ? { name: tenant.name, slug: tenant.slug } : `existing: ${tenant.name}`,
        admin: admin
          ? { email: admin.staff.email, temporaryPassword: admin.temporaryPassword ?? '(existing account: its own password)', superadmin: true }
          : 'skipped: the cafe already has an owner',
        branch: branch ?? 'skipped: a branch already exists',
      },
    }
  },
})
