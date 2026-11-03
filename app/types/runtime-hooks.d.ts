declare module '#app' {
  interface RuntimeNuxtHooks {
    /** Features whose data changed in this tab (`invalidate()`). Forwarded to other tabs by plugins/data-freshness.client.ts. */
    'app:data-changed': (features: string[]) => void
    /** Any surface established or voluntarily ended the browser session; forwarded to other tabs. */
    'app:auth-changed': (event: import('../composables/useSessionIdentity').AuthEvent) => void
    /** Shared identity generation advanced; session-boundary clears data outside the originating surface. */
    'app:session-changed': (session: { signedIn: boolean, source?: import('../composables/useSessionIdentity').SessionSurface }) => void
  }
}

export {}
