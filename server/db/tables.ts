/**
 * Every table the application services query, for explicit imports (services and tests don't use
 * Nitro auto-imports). The features' own tables come from their `*.schema.ts`.
 */
// Better Auth's tables (plugins included) as NuxtHub merges them; '#auth/schema' types only the core ones.
// An organization is a tenant (D134).
export { account, member, organization, session, user } from 'hub:db:schema'
// Owned by the platform feature (D50).
export { auditEvents } from '#server/features/platform/platform.schema'
// Owned by the branches feature; identity reads them for access checks (D134).
export { branches, branchStaff } from '#server/features/branches/branches.schema'
