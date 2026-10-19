// Public API of the tenants feature: the platform console (step T2a, D142). Other code imports only from here.
export { changeTenantSlug, checkSlug, countTenants, createTenant, currentSlugFor, getCafeProfile, getCafeSettings, getOwnerAccount, getTenant, listAccountCafes, listTenants, resumeTenant, searchOwnerAccounts, seedTenant, suspendTenant, updateCafeSettings } from './tenants.service'
export type { PlatformActor } from './tenants.service'
export { TenantErrorCodes } from './tenants.errors'
