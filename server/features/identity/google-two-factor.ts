import { APIError, createAuthMiddleware } from 'better-auth/api'
import { twoFactor } from 'better-auth/plugins'

/** Better Auth's callback endpoint has a parameterized path, not a provider-specific path. */
export function isGoogleCallback(ctx: { path?: string, params?: Record<string, string | undefined> }) {
  return ctx.path?.startsWith('/callback/') === true && ctx.params?.id === 'google'
}

/** Reuse the native challenge, attempt limits, cookies and verification endpoints for Google. */
export function googleTwoFactor() {
  const plugin = twoFactor({ issuer: 'Angder' })
  const challenge = plugin.hooks.after[0]!
  const credentialSignIn = challenge.matcher
  challenge.matcher = ctx => credentialSignIn(ctx) || isGoogleCallback(ctx)
  plugin.hooks.after.push({
    matcher: isGoogleCallback,
    handler: createAuthMiddleware(async (ctx) => {
      const result = ctx.context.returned as { twoFactorRedirect?: boolean } | undefined
      if (result?.twoFactorRedirect !== true) return undefined
      // The callback already validated this destination and saved it in its redirect response.
      // The native challenge hook deleted the provisional session and replaced its cookies.
      const location = ctx.context.responseHeaders?.get('location')
      const target = location ? new URL(location, ctx.context.baseURL) : null
      if (!target || target.origin !== new URL(ctx.context.baseURL).origin
        || !['/google-callback', '/sign-in'].includes(target.pathname)) {
        throw new APIError('BAD_REQUEST', { code: 'INVALID_CALLBACK_URL', message: 'Restart sign-in to continue.' })
      }
      target.searchParams.set('googleTwoFactor', '1')
      throw ctx.redirect(target.toString())
    }),
  })
  return plugin
}
