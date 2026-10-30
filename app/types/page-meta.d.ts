declare module '#app' {
  interface PageMeta {
    /** Skip the auth middleware (e.g. login page). */
    public?: boolean
    /** Browser tab title, shown as "<title> · <cafe> Admin". Set it in every route file. */
    title?: string
    /**
     * The admin permission the page needs, as `resource:action` (`staff:read`): the one its main
     * read asks the server for. Without it the page says "No access to this page" before loading
     * anything, and the sidebar leaves it out. For the app only: the server checks every request.
     */
    permission?: string
    /**
     * The counter's: the branch permission the page needs at the branch in its path
     * (`table:manage`), from the session's branches (D240). Same refusal, same sidebar rule.
     */
    branchPermission?: string
  }
}

export {}
