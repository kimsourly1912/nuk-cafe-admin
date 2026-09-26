declare module '#app' {
  interface PageMeta {
    /** Skip the auth middleware (e.g. login page). */
    public?: boolean
    /** Browser tab title, shown as "<title> · NUK Cafe Admin". Set it in every route file. */
    title?: string
  }
}

export {}
