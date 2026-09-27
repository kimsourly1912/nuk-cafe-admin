import { admin, haveIBeenPwned, organization } from 'better-auth/plugins'
import type { ServerAuthConfig } from '@nuxtjs/better-auth/config'
import { branchAc, branchRoles, platformAc, platformRoles } from './identity.permissions'

const MINUTE = 60
const DAY = 24 * 60 * MINUTE

export interface IdentityAuthSettings {
  /** The public site URL (`NUXT_PUBLIC_SITE_URL`); the only origin trusted besides dev origins. */
  siteUrl?: string
  /** Check new passwords against Have I Been Pwned. Off only in tests (it calls an external API). */
  checkBreachedPasswords?: boolean
}

/**
 * Our Better Auth configuration (docs/server/security.md, D45, D47). `server/auth.config.ts` passes
 * it to `defineServerAuth`; the identity tests run it against an in-memory adapter.
 */
export function identityAuthOptions({ siteUrl, checkBreachedPasswords = true }: IdentityAuthSettings) {
  return {
    emailAndPassword: { enabled: true },
    trustedOrigins: siteUrl ? [new URL(siteUrl).origin] : [],
    session: {
      // 7 days for everyone, extended once a day while used (D45).
      expiresIn: 7 * DAY,
      updateAge: DAY,
    },
    user: {
      additionalFields: {
        // Set when an admin creates a staff account with a temporary password. Better Auth doesn't
        // enforce it: our access helpers refuse with PASSWORD_CHANGE_REQUIRED (security.md).
        mustChangePassword: { type: 'boolean', required: false, defaultValue: false, input: false },
      },
    },
    rateLimit: {
      // A Worker instance's memory is not shared with other instances. Better Auth enables rate
      // limiting in production only.
      storage: 'database',
      customRules: {
        '/sign-in/email': { window: MINUTE, max: 5 },
        '/sign-up/email': { window: 10 * MINUTE, max: 5 },
        '/request-password-reset': { window: 10 * MINUTE, max: 3 },
        '/reset-password': { window: 10 * MINUTE, max: 5 },
        '/send-verification-email': { window: 10 * MINUTE, max: 3 },
        '/change-password': { window: MINUTE, max: 5 },
      },
    },
    plugins: [
      admin({
        ac: platformAc,
        roles: platformRoles,
        defaultRole: 'customer',
        adminRoles: ['admin'],
      }),
      organization({
        // A branch is an organization. Only platform admins create branches.
        ac: branchAc,
        roles: branchRoles,
        allowUserToCreateOrganization: user => user.role === 'admin',
        // Better Auth always makes the creator a member; `owner` is not one of our roles.
        creatorRole: 'manager',
        // Branches are archived (status), never deleted: orders and reports reference them.
        disableOrganizationDeletion: true,
        schema: {
          organization: {
            additionalFields: {
              timezone: { type: 'string', required: true },
              currency: { type: 'string', required: false, defaultValue: 'USD' },
              address: { type: 'string', required: false },
              phone: { type: 'string', required: false },
              status: { type: 'string', required: false, defaultValue: 'active', input: false },
            },
          },
        },
      }),
      haveIBeenPwned({ enabled: checkBreachedPasswords }),
    ] as const,
  } satisfies ServerAuthConfig
}
