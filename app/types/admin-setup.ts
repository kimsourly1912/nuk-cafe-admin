/**
 * The home page's "Set up your cafe" (D155): each feature with something a new cafe has to do
 * exports one step from its `index.ts`; `utils/admin-setup.ts` lists them, like the sidebar.
 */
export interface AdminSetupStep {
  id: string
  /** What to do: "Set your opening hours". */
  label: string
  /** Why, in one line. */
  description: string
  /** Where it's done, inside the cafe (`/admin/branches`); the page adds the cafe's address. */
  page: string
  /** Nice to have: a cafe takes orders without it. */
  optional?: boolean
  /** Done (`true`), still to do (`false`), or doesn't apply on this server (`null`). Read from the API. */
  check: () => Promise<boolean | null>
}
