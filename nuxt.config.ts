// https://nuxt.com/docs/api/configuration/nuxt-config
const apiProxyTarget = process.env.API_PROXY_TARGET ?? 'https://dev-api.nukcafe.co/nukcafe/api/v2'

export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@nuxt/test-utils/module',
  ],
  // SPA: the backend's auth cookies are HttpOnly and only visible to the browser,
  // so every API call must originate client-side.
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
      // Base URL for the backend API. Override with NUXT_PUBLIC_API_BASE.
      // Defaults to the dev proxy below so auth cookies are first-party on localhost.
      apiBase: '/api',
    },
  },
  compatibilityDate: '2025-07-15',
  nitro: {
    // The backend sets SameSite=Lax cookies without a Domain, which browsers drop on
    // cross-site requests. Proxy /api through the Nuxt dev server so they stick to localhost.
    devProxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
        // Present requests as same-origin; the backend's CORS allowlist rejects other localhost ports.
        headers: { origin: new URL(apiProxyTarget).origin },
      },
    },
  },
  eslint: {
    config: {
      stylistic: true,
      formatters: true,
    },
  },
})
