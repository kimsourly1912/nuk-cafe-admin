declare module '#app' {
  interface PageMeta {
    /** Skip the auth middleware (e.g. login page). */
    public?: boolean
  }
}

export {}
