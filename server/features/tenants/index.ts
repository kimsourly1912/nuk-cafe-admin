// Public API of the tenants feature: the platform console (step T2a, D142). Other code imports only from here.
export { addOwner, changeTenantSlug, checkSlug, countTenants, createTenant, currentSlugFor, getCafeProfile, getCafeSettings, getOwnerAccount, getTenant, listAccountCafes, listTenants, removeOwner, resumeTenant, searchOwnerAccounts, seedTenant, suspendTenant, transferOwner, updateCafeSettings, updateTenantNotes } from './tenants.service'
export type { PlatformActor } from './tenants.service'
export { getPlatformOverview, listPlatformActivity, QUIET_DAYS } from './activity.service'
export { TenantErrorCodes } from './tenants.errors'
export { getPlatformHealth } from './health.service'
export { webManifest } from './web-manifest'
export type { WebManifest } from './web-manifest'

export { activeCafe, findTenant, findTenantBySlug, findActiveTenant, listActiveTenantPage } from './tenants.repository'
