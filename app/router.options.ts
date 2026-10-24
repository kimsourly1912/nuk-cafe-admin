import type { RouterConfig } from 'nuxt/schema'
import { createWebHistory } from 'vue-router'

/**
 * The browser's history with an entry for every open overlay, so Back closes it (D201,
 * `app/utils/overlay-history.ts`). The server keeps Nuxt's own memory history.
 */
export default {
  history: base => (import.meta.client ? overlayHistory().wrap(createWebHistory(base)) : undefined),
} satisfies RouterConfig
