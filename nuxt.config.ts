import { cpSync, existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Local and e2e builds (node-server preset) only: libsql loads its native binary with a computed
 * `require('@libsql/<platform>')` that Nitro's file tracer can't follow, so the built server crashed
 * at startup. After compiling, copy the installed binary package next to the traced `libsql`.
 * Cloudflare builds use D1 and never load libsql. Does nothing when libsql isn't installed.
 */
function copyLibsqlNativeBinary(serverDir: string) {
  let scopeDir: string
  try {
    const require = createRequire(import.meta.url)
    const libsqlEntry = createRequire(require.resolve('@libsql/client')).resolve('libsql')
    scopeDir = join(dirname(libsqlEntry), '..', '@libsql')
  }
  catch {
    return
  }
  if (!existsSync(join(serverDir, 'node_modules', 'libsql'))) return
  for (const name of readdirSync(scopeDir)) {
    cpSync(join(scopeDir, name), join(serverDir, 'node_modules', '@libsql', name), { recursive: true, dereference: true })
  }
}

/**
 * Response headers for every route in production (D48). Scripts still allow `'unsafe-inline'`: the
 * SPA shell carries Nuxt's inline config script and the color-mode script, whose content changes
 * per environment. A nonce-based script policy comes with server rendering (step 5.2). Everything
 * else is locked to this origin: no framing, no plugins, no requests or form posts elsewhere.
 */
function securityHeaders(): Record<string, string> {
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'unsafe-inline'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join('; ')
  return {
    'content-security-policy': csp,
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'cross-origin-opener-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  }
}

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/ui', '@nuxt/test-utils/module', '@nuxthub/core', '@nuxtjs/better-auth'],
  $production: {
    // Security headers (docs/server/security.md → Request protection). Production builds only: the
    // Vite dev server needs inline scripts and a websocket. The e2e suite runs a production build.
    routeRules: { '/**': { headers: securityHeaders() } },
  },
  // The existing admin UI remains a SPA while Nitro hosts the new local API.
  ssr: false,
  devtools: { enabled: true },
  app: {
    head: {
      title: 'NUK Cafe Admin',
    },
  },
  css: ['@/assets/css/tailwind.css'],
  runtimeConfig: {
    // The seed task's first admin (server/tasks/db/seed.ts): NUXT_SEED_ADMIN_EMAIL, NUXT_SEED_ADMIN_NAME.
    seed: { adminEmail: '', adminName: 'Admin' },
    // Account emails (docs/server/operations.md → Email): NUXT_MAIL_RESEND_API_KEY, NUXT_MAIL_FROM
    // ("NUK Cafe <no-reply@…>", a domain verified in Resend; Q4). Without a key the dev server
    // prints mail to the console; a production build refuses to (the links are secrets).
    mail: { resendApiKey: '', from: '' },
    public: {
      // NUXT_PUBLIC_CAFE_TIME_ZONE: the zone schedule times are in (one branch, D41).
      cafeTimeZone: 'Asia/Phnom_Penh',
    },
  },
  routeRules: {
    // Session gate per surface (@nuxtjs/better-auth), a second line behind each route's own
    // requirePermission / requireBranchPermission / requireCustomer (docs/server/security.md).
    '/api/admin/**': { auth: { only: 'user', user: { role: 'admin' } } },
    // The admin app's session check answers non-admins itself (403 NOT_ADMIN, a clearer message).
    '/api/admin/me': { auth: 'user' },
    '/api/counter/**': { auth: 'user' },
    '/api/shop/**': { auth: 'user' },
    // API responses are personal or change often; a public route opts in to caching explicitly.
    '/api/**': { headers: { 'cache-control': 'no-store' } },
  },
  compatibilityDate: '2025-07-15',
  nitro: {
    // Scheduled jobs and the seed task (docs/server/operations.md).
    experimental: { tasks: true },
    // Cron in UTC. On Cloudflare they become Worker cron triggers; in dev Nitro runs them itself.
    scheduledTasks: {
      '* * * * *': ['platform:deliver-outbox'],
      '15 3 * * *': ['platform:expire-idempotency-keys'],
    },
    hooks: {
      compiled(nitro) {
        if (nitro.options.preset.startsWith('node')) copyLibsqlNativeBinary(nitro.options.output.serverDir)
      },
    },
  },
  hub: {
    blob: true,
    db: {
      dialect: 'sqlite',
      casing: 'snake_case',
    },
  },
  hooks: {
    // Our error handler answers /api/** in the API's error format; Nuxt's own handler (set before
    // this hook runs) stays next in line for pages. Nitro tries handlers in order.
    // Each server feature owns its tables in server/features/<feature>/<feature>.schema.ts
    // (docs/server/architecture.md → Features); NuxtHub reads server/db/schema/ by itself.
    'hub:db:schema:extend'({ paths }) {
      const featuresDir = fileURLToPath(new URL('./server/features', import.meta.url))
      for (const feature of readdirSync(featuresDir)) {
        const schema = join(featuresDir, feature, `${feature}.schema.ts`)
        // Forward slashes: NuxtHub writes these paths into a generated import (like the error handler).
        if (existsSync(schema)) paths.push(schema.replaceAll('\\', '/'))
      }
    },
    // NuxtHub declares 'hub:db:schema' for the app and Nitro type projects only. The node project
    // reaches the server utils through Nitro's auto-import types, so it needs the declaration too.
    'prepare:types'({ nodeReferences }) {
      nodeReferences.push({ path: 'hub/db/schema.d.ts' })
    },
    'nitro:config'(nitroConfig) {
      const nuxtHandlers = [nitroConfig.errorHandler ?? []].flat()
      // Forward slashes: Nitro writes this path into a generated import (Windows backslashes break it).
      const apiHandler = fileURLToPath(new URL('./server/error-handler.ts', import.meta.url)).replaceAll('\\', '/')
      nitroConfig.errorHandler = [apiHandler, ...nuxtHandlers]
    },
  },
  eslint: {
    config: {
      stylistic: true,
      formatters: true,
    },
  },
  icon: {
    // With ssr: false, @nuxt/icon defaults to fetching from api.iconify.design at runtime.
    // Bundle the icons we use into the client build instead and never fetch.
    provider: 'none',
    clientBundle: {
      // Nuxt UI adds its own icons (chevrons, close, loading, ...) through the icon:clientBundleIcons hook.
      // Icon names must be literal strings ('i-lucide-tags') to be found; built names aren't.
      scan: {
        // .ts is excluded by default, but navigation.ts, useMutation.ts, ... hold icon names.
        globInclude: ['app/**/*.{vue,ts}'],
        globExclude: ['app/generated/**', 'node_modules', '.*'],
      },
    },
  },
})
