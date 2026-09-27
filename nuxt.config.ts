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

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/ui', '@nuxt/test-utils/module', '@nuxthub/core', '@nuxtjs/better-auth'],
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
    // NUXT_BOOTSTRAP_TOKEN: enables POST /api/v1/bootstrap/admin (first admin) while set; ≥ 32 characters.
    bootstrapToken: '',
    public: {
      // NUXT_PUBLIC_CAFE_TIME_ZONE: the zone schedule times are in (one branch, D41).
      cafeTimeZone: 'Asia/Phnom_Penh',
    },
  },
  compatibilityDate: '2025-07-15',
  nitro: {
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
