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

/** Scheduled jobs, cron in UTC (docs/server/operations.md → Scheduled jobs). */
const SCHEDULED_TASKS: Record<string, string[]> = {
  '* * * * *': ['platform:deliver-outbox', 'orders:expire-unpaid'],
  '15 3 * * *': ['platform:expire-idempotency-keys', 'assistant:purge-usage'],
  '5 * * * *': ['media:purge-temporary'],
}

/**
 * Staging on Cloudflare (D53): `nuxt build --envName staging` builds a Worker for
 * `nuk-cafe-staging.<account>.workers.dev` with its own D1 database and R2 bucket. Secrets
 * (`NUXT_BETTER_AUTH_SECRET`, later the Resend key) are Worker secrets, never in this file.
 */
const STAGING = {
  worker: 'nuk-cafe-staging',
  siteUrl: 'https://nuk-cafe-staging.kimsur61.workers.dev',
  d1DatabaseId: '33752107-bc40-4c31-8ff0-d3c50dc6a3a2',
  r2Bucket: 'nuk-cafe-staging-media',
}

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/ui', '@nuxt/test-utils/module', '@nuxthub/core', '@nuxtjs/better-auth'],
  $development: {
    runtimeConfig: { public: { sampleData: { enabled: true, environment: 'Local' } } },
  },
  $env: {
    staging: {
      // `--envName staging` replaces `$production` (one environment block applies), so the security
      // headers are repeated here.
      routeRules: { '/**': { headers: securityHeaders() } },
      nitro: {
        preset: 'cloudflare_module',
        cloudflare: {
          wrangler: {
            name: STAGING.worker,
            // Workers Logs: the structured logs (docs/server/operations.md → Monitoring).
            observability: { enabled: true },
            // Public, not secret: Better Auth's base URL and the only trusted origin.
            vars: {
              NUXT_PUBLIC_SITE_URL: STAGING.siteUrl,
              // Resend's test sender until the sending domain is set up (Q4): it delivers only to the
              // Resend account's own address, so staging can't mail anyone else.
              NUXT_MAIL_FROM: 'NUK Cafe <onboarding@resend.dev>',
              // The Sample data page (D94): test data can be loaded and reset here.
              NUXT_PUBLIC_SAMPLE_DATA_ENABLED: 'true',
              NUXT_PUBLIC_SAMPLE_DATA_ENVIRONMENT: 'Staging',
              // The AI assistant (D107, D108; owner, 2026-09-30): OpenAI. The key is the Worker
              // secret NUXT_AI_API_KEY, set by the owner; without it the assistant stays off.
              NUXT_AI_PROVIDER: 'openai',
              NUXT_AI_MODEL: 'gpt-5.4-mini',
            },
            // Cloudflare calls the Worker on these; Nitro runs the matching tasks.
            triggers: { crons: Object.keys(SCHEDULED_TASKS) },
          },
        },
      },
      hub: {
        // NuxtHub binds these as `DB` and `BLOB` and points D1 at our migrations.
        db: { dialect: 'sqlite', casing: 'snake_case', connection: { databaseId: STAGING.d1DatabaseId } },
        blob: { driver: 'cloudflare-r2', binding: 'BLOB', bucketName: STAGING.r2Bucket },
      },
    },
  },
  $production: {
    // Security headers (docs/server/security.md → Request protection). Production builds only: the
    // Vite dev server needs inline scripts and a websocket. The e2e suite runs a production build.
    routeRules: { '/**': { headers: securityHeaders() } },
  },
  // The customer site is server-rendered (D45, D95); the admin workspace stays a SPA
  // (`routeRules` below). Counter screens will be SPAs too.
  ssr: true,
  devtools: { enabled: true },
  app: {
    head: {
      title: 'NUK Cafe',
      htmlAttrs: { lang: 'en' },
    },
  },
  css: ['@/assets/css/tailwind.css'],
  // Light unless the person picks dark with the color-mode button (D96): the system setting is
  // ignored. The choice is kept in this browser (localStorage `nuxt-color-mode`) and applied before
  // the first paint by the color-mode script, on server-rendered and browser-only pages alike.
  colorMode: { preference: 'light', fallback: 'light' },
  runtimeConfig: {
    // The seed task's first admin (server/tasks/db/seed.ts): NUXT_SEED_ADMIN_EMAIL, NUXT_SEED_ADMIN_NAME.
    seed: { adminEmail: '', adminName: 'Admin' },
    // Account emails (docs/server/operations.md → Email): NUXT_MAIL_RESEND_API_KEY, NUXT_MAIL_FROM
    // ("NUK Cafe <no-reply@…>", a domain verified in Resend; Q4). Without a key the dev server
    // prints mail to the console; a production build refuses to (the links are secrets).
    mail: { resendApiKey: '', from: '' },
    // Table QR codes (D91, docs/server/operations.md → Configuration): NUXT_QR_SECRET, a long random
    // secret per environment. Changing it invalidates every printed QR. Deployed builds refuse to
    // serve table QRs without it; the dev server uses a local one.
    qrSecret: '',
    // The AI assistant (phase 9, D107, D108; docs/server/operations.md → Configuration):
    // NUXT_AI_PROVIDER (anthropic | openai | google | openai-compatible), NUXT_AI_MODEL,
    // NUXT_AI_API_KEY (a secret), NUXT_AI_BASE_URL (openai-compatible only), NUXT_AI_DAILY_LIMIT.
    // Without a key the assistant is off: its routes answer 404.
    ai: { provider: '', model: '', apiKey: '', baseUrl: '', dailyLimit: 100 },
    public: {
      // NUXT_PUBLIC_CAFE_TIME_ZONE: the zone schedule times are in (one branch, D41).
      cafeTimeZone: 'Asia/Phnom_Penh',
      // The Sample data page (D94): on for the dev server and staging (NUXT_PUBLIC_SAMPLE_DATA_ENABLED,
      // NUXT_PUBLIC_SAMPLE_DATA_ENVIRONMENT names the environment on the page). Off everywhere else:
      // production never gets it, and its routes answer 404.
      sampleData: { enabled: false, environment: '' },
    },
  },
  routeRules: {
    // The admin workspace renders in the browser only: its pages need the staff session and never
    // need search engines (D95).
    '/admin': { ssr: false },
    '/admin/**': { ssr: false },
    // A table's QR link stores the table in this tab and moves on to the menu: browser work only.
    '/table/**': { ssr: false },
    // Checkout and a customer's order are theirs alone and read browser storage and the session:
    // browser work only, like a table's QR link (D100).
    '/checkout': { ssr: false },
    '/orders/**': { ssr: false },
    // The counter workspace, like the admin: the staff session, no search engines (D102).
    '/counter': { ssr: false },
    '/counter/**': { ssr: false },
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
    scheduledTasks: SCHEDULED_TASKS,
  },
  hub: {
    // The e2e build keeps its data apart (test/e2e/support/global-setup.ts, D95); everything else uses .data.
    ...(process.env.E2E_HUB_DIR ? { dir: process.env.E2E_HUB_DIR } : {}),
    blob: true,
    db: {
      dialect: 'sqlite',
      casing: 'snake_case',
      // Local SQLite (dev and e2e, D103): wait up to 5 s for another writer to finish instead of
      // failing at once with SQLITE_BUSY (a second process writing to the file, e.g. a test). D1,
      // on staging and in production, has no file lock and ignores it.
      connection: { timeout: 5000 },
    },
  },
  hooks: {
    // Added through nitro:init, not `nitro.hooks`: a `compiled` key there replaces the Cloudflare
    // preset's own `compiled` hook, which writes wrangler.json (D53).
    'nitro:init'(nitro) {
      nitro.hooks.hook('compiled', () => {
        if (nitro.options.preset.startsWith('node')) copyLibsqlNativeBinary(nitro.options.output.serverDir)
      })
    },
    // Our error handler answers /api/** in the API's error format; Nuxt's own handler (set before
    // this hook runs) stays next in line for pages. Nitro tries handlers in order.
    // Each server feature owns its tables in server/features/<feature>/<feature>.schema.ts
    // (docs/server/architecture.md → Features), registered here.
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
