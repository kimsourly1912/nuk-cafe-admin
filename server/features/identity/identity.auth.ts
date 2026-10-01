import { createAuthMiddleware, isAPIError } from 'better-auth/api'
import { admin, haveIBeenPwned, organization } from 'better-auth/plugins'
import type { ServerAuthConfig } from '@nuxtjs/better-auth/config'
import type { Db } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import { log } from '#server/utils/log'
import { outboxStatement } from '#server/features/platform'
import { MAIL_KINDS } from './identity.mail'
import { branchAc, branchRoles, platformAc, platformRoles } from './identity.permissions'

const MINUTE = 60
const DAY = 24 * 60 * MINUTE

export interface IdentityAuthSettings {
  /** The database Better Auth uses (NuxtHub's), for the outbox and customer profiles. */
  db: Db
  /** The public site URL (`NUXT_PUBLIC_SITE_URL`); the only origin trusted besides dev origins. */
  siteUrl?: string
  /** Check new passwords against Have I Been Pwned. Off only in tests (it calls an external API). */
  checkBreachedPasswords?: boolean
}

/** Queues an account email (verification, reset); `platform:deliver-outbox` sends it. */
async function queueMail(db: Db, kind: string, to: string, url: string) {
  await db.batch([outboxStatement(db, kind, { to, url })])
}

/**
 * The user a password reset is for, from the token, remembered between the before and after hooks
 * of one request (they share `ctx.context`). Used to clear a temporary password once the reset
 * succeeded: the token is gone by then.
 */
const resetFor = new WeakMap<object, string>()

/**
 * Our Better Auth configuration (docs/server/security.md, D45, D47). `server/auth.config.ts` passes
 * it to `defineServerAuth`; the identity tests run it against the real migration.
 */
export function identityAuthOptions({ db, siteUrl, checkBreachedPasswords = true }: IdentityAuthSettings) {
  return {
    emailAndPassword: {
      enabled: true,
      // Signing in works before the email is verified; shop writes don't (requireCustomer, D51).
      requireEmailVerification: false,
      resetPasswordTokenExpiresIn: 60 * MINUTE,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => queueMail(db, MAIL_KINDS.resetPassword, user.email, url),
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: DAY,
      sendVerificationEmail: async ({ user, url }) => queueMail(db, MAIL_KINDS.verifyEmail, user.email, url),
    },
    databaseHooks: {
      user: {
        create: {
          // Every account gets a customer profile (member code). D1 has no transactions, so this
          // runs after the account is stored; if it fails, the account still works and
          // `ensureProfile` creates the profile on first use. Loaded lazily: the module loads this
          // file at build time, before the customers schema's imports exist.
          after: async (user) => {
            try {
              const { ensureProfile } = await import('#server/features/customers')
              await ensureProfile(db, user.id)
            }
            catch (error) {
              log('error', 'Customer profile not created at sign-up; created on first use instead', { userId: user.id, error: String(error) })
            }
          },
        },
      },
    },
    // UUID v7 like every other table, so Better Auth's ids (users, branches) pass readIdParam.
    advanced: {
      database: { generateId: () => newId() },
      // Rate limits count per client address (D103). Cloudflare sets `cf-connecting-ip` itself (a
      // client can't forge it); Better Auth's default, `x-forwarded-for`, a client can. Without an
      // address every request shares one bucket: all visitors together get 5 sign-ins a minute.
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
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
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/reset-password' || typeof ctx.body?.token !== 'string') return
        const verification = await ctx.context.internalAdapter.findVerificationValue(`reset-password:${ctx.body.token}`)
        if (verification?.value) resetFor.set(ctx.context, verification.value)
      }),
      // A temporary password is cleared once its owner replaces it, by changing it or by a reset
      // link (security.md → Staff onboarding). Only these routes: a password an admin sets stays
      // temporary.
      after: createAuthMiddleware(async (ctx) => {
        if (isAPIError(ctx.context.returned)) return
        const userId = ctx.path === '/change-password'
          ? ctx.context.session?.user.id
          : ctx.path === '/reset-password' ? resetFor.get(ctx.context) : undefined
        if (userId) await ctx.context.internalAdapter.updateUser(userId, { mustChangePassword: false })
      }),
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
              // The lock for the branch's settings and hours (D41, D91): every save names it.
              version: { type: 'number', required: false, defaultValue: 1, input: false },
            },
          },
        },
      }),
      haveIBeenPwned({ enabled: checkBreachedPasswords }),
    ] as const,
  } satisfies ServerAuthConfig
}
