import { defineServerAuth } from '@nuxtjs/better-auth/config'
import type { Db } from './utils/batch'
// Not the feature's index: the module loads this file at build time to generate the auth schema,
// before 'hub:db:schema' exists, so it must not pull in the identity repository.
import { identityAuthOptions } from './features/identity/identity.auth'

export default defineServerAuth(({ runtimeConfig, db }) => identityAuthOptions({
  // NuxtHub's database, the one Better Auth itself uses.
  db: db as Db,
  siteUrl: (runtimeConfig.public as { siteUrl?: string } | undefined)?.siteUrl || undefined,
}))
