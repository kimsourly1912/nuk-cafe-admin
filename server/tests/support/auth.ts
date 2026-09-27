import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import * as authSchema from '#auth/schema'
import { identityAuthOptions } from '../../features/identity/identity.auth'
import type { Db } from '../../utils/batch'

export const TEST_SITE = 'https://cafe.example'

/** Our Better Auth configuration on a test database (no breached-password lookups). */
export function createTestAuth(db: Db) {
  return betterAuth({
    ...identityAuthOptions({ db, siteUrl: TEST_SITE, checkBreachedPasswords: false }),
    baseURL: TEST_SITE,
    secret: 'test-secret-that-is-at-least-32-characters-long',
    database: drizzleAdapter(db, { provider: 'sqlite', schema: authSchema }),
  })
}

export type TestAuth = ReturnType<typeof createTestAuth>

/** The request headers of a session, from a response's `Set-Cookie`. */
export function sessionHeaders(headers: Headers) {
  return new Headers({ cookie: headers.getSetCookie().map(c => c.split(';')[0]).join('; ') })
}

/** Signs in with email and password; returns the session's headers. Throws when refused. */
export async function signIn(auth: TestAuth, email: string, password: string) {
  const { headers } = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true })
  return sessionHeaders(headers)
}
