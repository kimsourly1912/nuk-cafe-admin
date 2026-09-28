/**
 * Every table the application services query, for explicit imports (services and tests don't use
 * Nitro auto-imports). The features' own tables come from their `*.schema.ts`.
 */
// Better Auth's tables (plugins included) as NuxtHub merges them; '#auth/schema' types only the core ones.
export { account, member, organization, session, user } from 'hub:db:schema'
// Owned by the platform feature (D50).
export { auditEvents } from '../features/platform/platform.schema'
