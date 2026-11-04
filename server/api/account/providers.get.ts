import { accountProviders } from '#server/features/identity'

/** Read current availability instead of flags captured in a cached page or older tab. */
export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return accountProviders({ ...config.googleAuth, enabled: config.public.googleAuth.enabled })
})
