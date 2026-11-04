import type { AccountProviders } from '#shared/contracts/account'

export interface GoogleAuthSettings {
  enabled: boolean
  clientId: string
  clientSecret: string
}

/** Public availability only. The same predicate controls the actual server provider. */
export function accountProviders(google?: GoogleAuthSettings): AccountProviders {
  return { google: Boolean(google?.enabled && google.clientId && google.clientSecret) }
}
