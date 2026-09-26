// https://nuxt.com/docs/api/configuration/nuxt-config
const legacyApiProxyTarget = process.env.LEGACY_API_PROXY_TARGET ?? 'https://dev-api.nukcafe.co/nukcafe/api/v2'

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
    public: {
      // Temporary base for the existing Spring SDK. New Nitro routes own /api.
      legacyApiBase: '/legacy-api',
    },
  },
  compatibilityDate: '2025-07-15',
  nitro: {
    // Keep the old admin screens working without intercepting Better Auth's /api/auth routes.
    // Remove this when those screens use the new Nitro API.
    devProxy: {
      '/legacy-api': {
        target: legacyApiProxyTarget,
        changeOrigin: true,
        headers: { origin: new URL(legacyApiProxyTarget).origin },
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
