import { defineServerAuth } from '@nuxtjs/better-auth/config'
// Not the feature's index: the module loads this file at build time to generate the auth schema,
// before 'hub:db:schema' exists, so it must not pull in the identity repository.
import { identityAuthOptions } from './features/identity/identity.auth'

export default defineServerAuth(({ runtimeConfig }) => identityAuthOptions({
  siteUrl: (runtimeConfig.public as { siteUrl?: string } | undefined)?.siteUrl || undefined,
}))
