// Public API of the support feature: support access (step P5, D193). Other code imports only from here.
export { allowSupport, closeSupportVisits, endSupport, endSupportVisit, getCafeSupport, openSupportVisit, supportActor, supportSession, tenantSupport } from './support.service'
export type { SupportRequest, SupportVisitor } from './support.service'
export { SupportErrorCodes } from './support.errors'
export { SUPPORT_READ_PERMISSIONS } from './support.rules'
