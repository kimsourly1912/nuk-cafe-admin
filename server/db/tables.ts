/**
 * Every table the application services query, for explicit imports (services and tests don't use
 * Nitro auto-imports). NuxtHub itself reads `server/db/schema/*.ts`.
 */
// Better Auth's tables (plugins included) as NuxtHub merges them; '#auth/schema' types only the core ones.
export { member, organization, user } from 'hub:db:schema'
export * from './schema/identity'
export * from './schema/media'
export * from './schema/menu'
