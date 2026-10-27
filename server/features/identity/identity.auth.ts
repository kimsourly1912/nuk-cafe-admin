import { createAuthMiddleware, isAPIError } from 'better-auth/api'
import { admin, anonymous, haveIBeenPwned, organization, twoFactor } from 'better-auth/plugins'
import type { ServerAuthConfig } from '@nuxtjs/better-auth/config'
import type { Db } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import { outboxStatement } from '#server/features/platform'
import { MAIL_KINDS } from './identity.mail'
import { platformAc, platformRoles, tenantAc, tenantRoles } from './identity.permissions'
import { HUMAN_CHECK_HEADER, humanCheckAction } from '#shared/utils/human-check'
import { verifyHumanCheck } from './human-check'
import type { HumanCheckSettings } from './human-check'

const MINUTE = 60
const DAY = 24 * 60 * MINUTE

export interface IdentityAuthSettings {
  /** The database Better Auth uses (NuxtHub's), for the outbox and customer profiles. */
  db: Db
  /** The public site URL (`NUXT_PUBLIC_SITE_URL`); the only origin trusted besides dev origins. */
  siteUrl?: string
  /** Check new passwords against Have I Been Pwned. Off only in tests (it calls an external API). */
  checkBreachedPasswords?: boolean
  humanCheck?: HumanCheckSettings
}

/** Queues an account email (verification, reset); `platform:deliver-outbox` sends it. */
async function queueMail(db: Db, kind: string, to: string, url: string) {
  // Account emails are the platform's, not a cafe's (D138).
  await db.batch([outboxStatement(db, null, kind, { to, url })])
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
export function identityAuthOptions({ db, siteUrl, checkBreachedPasswords = true, humanCheck }: IdentityAuthSettings) {
  return {
    emailAndPassword: {
      enabled: true,
      // Guests and unverified accounts can order (D156); verification still confirms account email.
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
    // No customer profile at sign-up: an account is the platform's, and Better Auth's request names
    // no cafe. Each cafe's profile (member code) is made when the account first uses that cafe
    // (`ensureProfile` on `/api/c/<slug>/shop/me`, D137, D221), never in a cafe it didn't visit.
    // UUID v7 like every other table, so Better Auth's ids (users, tenants) pass readIdParam.
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
        const action = humanCheckAction(ctx.path)
        if (humanCheck?.enabled && action) {
          await verifyHumanCheck({
            action,
            token: ctx.headers?.get(HUMAN_CHECK_HEADER),
            address: ctx.headers?.get('cf-connecting-ip'),
            secret: humanCheck.secret,
            siteUrl,
          })
        }
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
        // Setting up two-step sign-in (D188) ends the account's other sessions: a device signed in
        // before it, with the password alone, must not count as two-step. Only setup swaps the
        // session (a sign-in's code check starts from none), so the old and new sessions differ.
        const before = ctx.context.session?.session
        const after = ctx.context.newSession
        if (ctx.path === '/two-factor/verify-totp' && before && after && after.session.token !== before.token) {
          for (const other of await ctx.context.internalAdapter.listSessions(after.user.id)) {
            if (other.token !== after.session.token) await ctx.context.internalAdapter.deleteSession(other.token)
          }
        }
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
        // A guest is made only when Place order is pressed signed out (D156). Generous: the cafe's
        // customers share its Wi-Fi, so one address is many people.
        '/sign-in/anonymous': { window: 10 * MINUTE, max: 30 },
      },
    },
    plugins: [
      admin({
        ac: platformAc,
        roles: platformRoles,
        defaultRole: 'customer',
        adminRoles: ['superadmin'],
      }),
      organization({
        // A tenant (a cafe business) is an organization (D134); its branches are our own table.
        // Only super admins create tenants.
        ac: tenantAc,
        roles: tenantRoles,
        allowUserToCreateOrganization: user => user.role === 'superadmin',
        creatorRole: 'owner',
        // Tenants are suspended (status), never deleted: orders and reports reference them.
        disableOrganizationDeletion: true,
        schema: {
          organization: {
            additionalFields: {
              status: { type: 'string', required: false, defaultValue: 'active', input: false },
              // Why the platform paused it, for the platform team (D142); `null` while active.
              suspendedReason: { type: 'string', required: false, input: false },
              // The cafe's logo, an upload in its media (D143). No foreign key: Better Auth's fields
              // can't reference our tables (D134); the media feature attaches and releases it.
              logoAssetId: { type: 'string', required: false, input: false },
              // The lock for the tenant's own settings (D41).
              version: { type: 'number', required: false, defaultValue: 1, input: false },
            },
          },
        },
      }),
      haveIBeenPwned({ enabled: checkBreachedPasswords }),
      // Two-step sign-in (P1b, D188): an authenticator app's code (TOTP) or a backup code, after the
      // password. Required for super admins (\`authorizePlatform\`); any account that turns it on is
      // asked for a code at every sign-in. No "trust this device": sessions already last 7 days.
      twoFactor({ issuer: 'NUK Platform' }),
      // Guests (D156): Place order without an account signs the browser in as a guest, a user with
      // no email or password. Orders keep their owner, so "only your own orders" holds as before.
      anonymous({
        generateName: () => 'Guest',
        // Never deleted: their orders point at them (orders.customer_id is `restrict`).
        disableDeleteAnonymousUser: true,
        // The guest signs in or signs up on this device: their orders move to that account.
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          const { moveGuestOrders } = await import('#server/features/orders')
          await moveGuestOrders(db, anonymousUser.user.id, newUser.user.id)
        },
      }),
    ] as const,
  } satisfies ServerAuthConfig
}
