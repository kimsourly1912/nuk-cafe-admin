import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as authSchema from '#auth/schema'
import { AUTH_HTTP_ENDPOINTS } from '#server/features/identity/auth-endpoints'
import { createTestAuth, sessionHeaders, TEST_SITE as SITE } from '#server/tests/support/auth'
import type { TestAuth as Auth } from '#server/tests/support/auth'
import { createTestDb } from '#server/tests/support/db'
import type { Db } from '#server/utils/batch'

// Better Auth mounts every plugin endpoint under /api/auth. Only the ones the app's pages use are
// reachable from a browser; the rest would bypass our routes' rules, audit rows and version guards.
let db: Db
let auth: Auth
let accounts = 0

beforeEach(async () => {
  db = await createTestDb()
  auth = createTestAuth(db)
})

async function signUp() {
  const email = `person${++accounts}@example.com`
  const { headers, response } = await auth.api.signUpEmail({
    body: { email, password: 'a long enough password', name: 'Person' },
    returnHeaders: true,
  })
  return { userId: response.user.id, headers: sessionHeaders(headers) }
}

/** A browser's request to Better Auth, from this site. */
function post(path: string, body: unknown, headers = new Headers()) {
  headers.set('origin', SITE)
  headers.set('content-type', 'application/json')
  return auth.handler(new Request(`${SITE}/api/auth${path}`, { method: 'POST', headers, body: JSON.stringify(body) }))
}

/** A cafe with its owner (made by Better Auth as the creator) and a branch staff member. */
async function cafeWithStaff() {
  const owner = await signUp()
  await db.update(authSchema.user).set({ role: 'superadmin' }).where(eq(authSchema.user.id, owner.userId))
  const tenant = await auth.api.createOrganization({ body: { name: 'NUK Cafe', slug: 'nuk' }, headers: owner.headers })
  await db.update(authSchema.user).set({ role: 'customer' }).where(eq(authSchema.user.id, owner.userId))
  const staff = await signUp()
  await auth.api.addMember({ body: { organizationId: tenant!.id, userId: staff.userId, role: 'member' } })
  const [member] = await db.select().from(authSchema.member)
    .where(and(eq(authSchema.member.organizationId, tenant!.id), eq(authSchema.member.userId, staff.userId)))
  return { tenantId: tenant!.id, owner, staff, memberId: member!.id }
}

describe('Better Auth endpoints over HTTP', () => {
  it('an owner cannot make branch staff an owner through Better Auth (it skips permissions for owners)', async () => {
    const { tenantId, owner, memberId } = await cafeWithStaff()

    const response = await post('/organization/update-member-role', { organizationId: tenantId, memberId, role: 'owner' }, owner.headers)

    expect(response.status).toBe(404)
    const [member] = await db.select().from(authSchema.member).where(eq(authSchema.member.id, memberId))
    expect(member!.role).toBe('member')
  })

  it('branch staff cannot list the cafe\'s members, leave it, or pick an active cafe', async () => {
    const { tenantId, staff } = await cafeWithStaff()

    for (const path of ['/organization/get-full-organization', '/organization/list-members']) {
      const response = await auth.handler(new Request(`${SITE}/api/auth${path}?organizationId=${tenantId}`, { headers: staff.headers }))
      expect(response.status, path).toBe(404)
    }
    for (const path of ['/organization/leave', '/organization/set-active']) {
      expect((await post(path, { organizationId: tenantId }, staff.headers)).status, path).toBe(404)
    }
    expect(await db.select().from(authSchema.member).where(eq(authSchema.member.userId, staff.userId))).toHaveLength(1)
  })

  it('refuses the admin plugin, account updates and the rest, even with a path spelled differently', async () => {
    const customer = await signUp()
    for (const path of ['/admin/list-users', '/admin/impersonate-user', '/update-user', '/list-accounts', '/link-social', '/Organization/update-member-role', '/organization//leave']) {
      expect((await post(path, {}, customer.headers)).status, path).toBe(404)
    }
  })

  it('still answers every endpoint the pages use', async () => {
    await signUp()
    const signIn = await post('/sign-in/email', { email: `person${accounts}@example.com`, password: 'a long enough password' })
    expect(signIn.status).toBe(200)
    const session = await auth.handler(new Request(`${SITE}/api/auth/get-session`, { headers: sessionHeaders(signIn.headers) }))
    expect(session.status).toBe(200)
    // Links in emails and the OAuth return carry a token or provider in the path.
    expect(AUTH_HTTP_ENDPOINTS.some(endpoint => endpoint.test('/reset-password/a-token'))).toBe(true)
    expect(AUTH_HTTP_ENDPOINTS.some(endpoint => endpoint.test('/callback/google'))).toBe(true)
    expect(AUTH_HTTP_ENDPOINTS.some(endpoint => endpoint.test('/callback/google/extra'))).toBe(false)
  })
})
