// Public API of the tenants feature: the platform console (step T2a, D142). Other code imports only from here.
export { changeTenantSlug, createTenant, currentSlugFor, getTenant, listTenants, resumeTenant, seedTenant, suspendTenant } from './tenants.service'
export type { PlatformActor } from './tenants.service'
export { TenantErrorCodes } from './tenants.errors'
