// Public API of the auth feature. Other code imports only from '~/features/auth'.
export { CHANGE_PASSWORD_PATH, isAdminPath, LOGIN_PATH, loginRedirectTarget, useAuth } from './composables/useAuth'
export type { Credentials, SessionUser } from './composables/useAuth'
// The password rules, for the counter's own change-password page (D102).
export { emptyPasswordForm, passwordFormSchema } from './schemas/password-form'
export type { PasswordForm } from './schemas/password-form'
