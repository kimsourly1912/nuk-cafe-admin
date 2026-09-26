declare module '#app' {
  interface RuntimeNuxtHooks {
    /** Features whose data changed in this tab (`invalidate()`). Forwarded to other tabs by plugins/data-freshness.client.ts. */
    'app:data-changed': (features: string[]) => void
  }
}

export {}
