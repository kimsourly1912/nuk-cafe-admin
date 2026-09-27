// Public API of the auth feature. Other code imports only from '~/features/auth'.
export { CHANGE_PASSWORD_PATH, loginRedirectTarget, useAuth } from './composables/useAuth'
export type { Credentials, SessionUser } from './composables/useAuth'
