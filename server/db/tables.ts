/**
 * Every table the application services query, for explicit imports (services and tests don't use
 * Nitro auto-imports). NuxtHub itself reads `server/db/schema/*.ts`.
 */
export { user } from '#auth/schema'
export * from './schema/identity'
export * from './schema/media'
export * from './schema/menu'
