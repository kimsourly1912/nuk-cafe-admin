import { defineServerAuth } from '@nuxtjs/better-auth/config'
import { identityAuthOptions } from './features/identity'

export default defineServerAuth(({ runtimeConfig }) => identityAuthOptions({
  siteUrl: (runtimeConfig.public as { siteUrl?: string } | undefined)?.siteUrl || undefined,
}))
