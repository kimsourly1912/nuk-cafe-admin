/**
 * Every table the application services query, for explicit imports (services and tests don't use
 * Nitro auto-imports). The features' own tables come from their `*.schema.ts`.
 *
 * The only way one feature's repository reaches another's table (D194): read-only, and only the
 * columns listed below, in a join. Writes stay with the owner; anything else goes through the
 * owner's `index.ts` (docs/server/repositories.md → Other features' tables).
 */
// Better Auth's tables (plugins included) as NuxtHub merges them; '#auth/schema' types only the core ones.
// An organization is a tenant (D134), written by tenants. `user`, `member`, `session`, `account`
// are written by identity. Others may read `user.id`, `user.name` and `organization.id`, `.slug`,
// `.name`, `.status`.
export { account, member, organization, session, user } from 'hub:db:schema'
// Owned by the platform feature (D50); others add rows through `platform.auditStatement`.
export { auditEvents } from '#server/features/platform/platform.schema'
// Owned by the branches feature. Others may read `branches.id`, `.tenantId`, `.name`, `.timezone`,
// `.status`. Identity reads both for access checks (D134) and writes `branch_staff` with an
// account's memberships, in one batch (staff management).
export { branches, branchStaff } from '#server/features/branches/branches.schema'
