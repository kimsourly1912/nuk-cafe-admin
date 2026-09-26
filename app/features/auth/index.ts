// Public API of the auth feature. Other code imports only from '~/features/auth'.
export { loginRedirectTarget, useAuth } from './composables/useAuth'
export type { Credentials, SessionUser } from './composables/useAuth'
