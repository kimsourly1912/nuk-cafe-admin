import type { BetterAuthPlugin } from 'better-auth'

/**
 * The Better Auth endpoints a browser may call (`/api/auth/<path>`): the ones our pages and emails
 * use, nothing else. Better Auth mounts every plugin endpoint (organization members and roles,
 * the admin plugin's users, account updates…); those would change memberships and accounts without
 * our routes' rules, audit rows and version guards. `/organization/update-member-role` even skips
 * permissions for owners, so an owner could make anyone an owner. An allowlist, not a blocklist:
 * an endpoint a Better Auth upgrade adds stays closed until a page needs it.
 *
 * Only HTTP requests are checked; the server's own `auth.api.*` calls go through. A path spelled any
 * other way (case, `//`, encoded slashes) is not on the list and answers 404 like an unknown one.
 */
export const AUTH_HTTP_ENDPOINTS: readonly RegExp[] = [
  // Session and sign-in.
  /^\/get-session$/,
  /^\/sign-in\/email$/,
  /^\/sign-in\/social$/,
  // Guests (D156): Place order signed out.
  /^\/sign-in\/anonymous$/,
  /^\/sign-up\/email$/,
  /^\/sign-out$/,
  // Google's return (D261) and Better Auth's error page for a failed one.
  /^\/callback\/[\w-]+$/,
  /^\/error$/,
  // Passwords and email: forms, and the links in emails.
  /^\/change-password$/,
  /^\/request-password-reset$/,
  /^\/reset-password$/,
  /^\/reset-password\/[^/]+$/,
  /^\/send-verification-email$/,
  /^\/verify-email$/,
  // Account security (D242): sign out other devices, two-step sign-in (D188).
  /^\/revoke-other-sessions$/,
  /^\/two-factor\/enable$/,
  /^\/two-factor\/disable$/,
  /^\/two-factor\/verify-totp$/,
  /^\/two-factor\/verify-backup-code$/,
]

/** The path after Better Auth's base path (`/api/auth`), one trailing slash dropped; `null` outside it. */
export function authEndpointPath(url: string, baseURL: string): string | null {
  const basePath = new URL(baseURL).pathname.replace(/\/+$/, '')
  const pathname = new URL(url).pathname
  if (!pathname.startsWith(`${basePath}/`)) return null
  const path = pathname.slice(basePath.length)
  return path.length > 1 ? path.replace(/\/$/, '') : path
}

export const isAllowedAuthEndpoint = (path: string) => AUTH_HTTP_ENDPOINTS.some(endpoint => endpoint.test(path))

/** Answers 404 to any other Better Auth endpoint requested over HTTP. */
export function authEndpointAllowlist() {
  return {
    id: 'auth-endpoint-allowlist',
    onRequest: async (request, ctx) => {
      const path = authEndpointPath(request.url, ctx.baseURL)
      if (path !== null && isAllowedAuthEndpoint(path)) return
      return { response: new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'No such API endpoint.' }), { status: 404, headers: { 'content-type': 'application/json' } }) }
    },
  } satisfies BetterAuthPlugin
}
