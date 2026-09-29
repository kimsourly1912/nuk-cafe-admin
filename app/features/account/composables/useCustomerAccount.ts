import { useIntervalFn, useNow } from '@vueuse/core'
import type { CustomerAccount } from '#shared/contracts/account'
import type { ForgotPasswordForm, SignInForm, SignUpForm } from '../schemas/account-form'
import { ACCOUNT_PATHS } from '../utils/account'

/**
 * The customer's account on the customer site (step 5.2, D97): who is signed in, from
 * `GET /api/shop/me`, and the Better Auth calls behind the account pages. The admin has its own
 * (`useAuth`, D52); both read the same browser session (one sign-in per browser, D97).
 *
 * Read in the browser only (`server: false`): server-rendered pages are the same for everyone, and
 * the header shows a placeholder until the browser knows (D97). Signed out is `null`, not an error.
 */
export function useCustomerAccount() {
  const query = useApiQuery('account:me', loadAccount, { server: false, default: () => null })
  const account = computed(() => query.data.value)
  /** The first answer arrived (signed in or not); stays true while it's refetched. */
  const known = useState('account:known', () => false)
  watch(query.status, (status) => {
    if (status === 'success' || status === 'error') known.value = true
  }, { immediate: true })
  return { account, known, error: query.error, refresh: query.refresh }
}

/**
 * Signed out is Better Auth's `get-session` answering `null` (no failed request in the console on
 * every visit); only a session reads the account itself.
 */
async function loadAccount(): Promise<CustomerAccount | null> {
  const session = await $fetch<{ user: unknown } | null>('/api/auth/get-session', { retry: 0, timeout: 30_000 })
    .catch((error: unknown) => {
      throw ApiError.from(error)
    })
  if (!session?.user) return null
  try {
    return await apiFetch<CustomerAccount>('/shop/me')
  }
  catch (error) {
    // Signed out between the two requests.
    if (ApiError.from(error).kind === 'unauthorized') return null
    throw error
  }
}

/** Better Auth's routes (`/api/auth`): same origin, so the session cookie is set and sent. */
const authFetch = <T>(path: string, body: Record<string, unknown> = {}) =>
  $fetch<T>(`/api/auth${path}`, { method: 'POST', body, retry: 0, timeout: 30_000 })

/** Where the verification link lands (`?error=` when it doesn't work). */
const VERIFY_CALLBACK = ACCOUNT_PATHS.emailVerified
/** Where the reset link lands (`?token=`, or `?error=INVALID_TOKEN`). */
const RESET_CALLBACK = ACCOUNT_PATHS.resetPassword

/** Refetch the account here and in the site's other tabs. */
const accountChanged = () => invalidate('account')

/**
 * The account actions. Each throws `ApiError`; the pages turn it into words
 * (`accountFormError`) and keep their own `saving` state, like the admin's sign-in (D84).
 */
export function useAccountActions() {
  async function signIn(form: SignInForm) {
    await authFetch('/sign-in/email', { email: form.email, password: form.password })
    await accountChanged()
  }

  /** Creates the account and signs in; Better Auth sends the verification email (via the outbox). */
  async function signUp(form: SignUpForm) {
    await authFetch('/sign-up/email', { name: form.name, email: form.email, password: form.password, callbackURL: VERIFY_CALLBACK })
    await accountChanged()
  }

  async function signOut() {
    try {
      await authFetch('/sign-out')
    }
    finally {
      await accountChanged()
    }
  }

  async function resendVerification(email: string) {
    await authFetch('/send-verification-email', { email, callbackURL: VERIFY_CALLBACK })
  }

  /** Answers the same whether or not the email has an account. */
  async function requestPasswordReset(form: ForgotPasswordForm) {
    await authFetch('/request-password-reset', { email: form.email, redirectTo: RESET_CALLBACK })
  }

  /** Sets the new password; Better Auth signs the account out everywhere (D51). */
  async function resetPassword(token: string, newPassword: string) {
    await authFetch('/reset-password', { token, newPassword })
    await accountChanged()
  }

  return { signIn, signUp, signOut, resendVerification, requestPasswordReset, resetPassword }
}

/** Seconds between two emails of the same kind (the server allows about 3 per 10 minutes). */
export const RESEND_COOLDOWN_SECONDS = 60

/**
 * A wait before the same email can be sent again, shared by every place that offers it (the banner,
 * the account menu, the pages) so one countdown is shown. Kept for this tab only.
 */
export function useResendCooldown(kind: 'verify' | 'reset') {
  const until = useState(`account:cooldown:${kind}`, () => 0)
  const now = useNow({ scheduler: tick => useIntervalFn(tick, 1000) })
  const secondsLeft = computed(() => Math.max(0, Math.ceil((until.value - now.value.getTime()) / 1000)))
  const start = () => {
    until.value = Date.now() + RESEND_COOLDOWN_SECONDS * 1000
  }
  return { secondsLeft, start }
}

/**
 * "Resend email" for the signed-in account's verification, where no form shows the outcome (the
 * header's banner and account menu): a toast, and the shared 60 s wait.
 */
export function useResendVerification() {
  const { account } = useCustomerAccount()
  const { resendVerification } = useAccountActions()
  const cooldown = useResendCooldown('verify')
  const notify = useNotify()
  const sending = ref(false)

  async function resend() {
    const email = account.value?.email
    if (!email || sending.value || cooldown.secondsLeft.value) return
    sending.value = true
    try {
      await resendVerification(email)
      cooldown.start()
      notify.success('Verification email sent', `We sent a new link to ${email}.`)
    }
    catch (error) {
      notify.error('Couldn\'t send the email', error)
    }
    finally {
      sending.value = false
    }
  }

  const label = computed(() => (cooldown.secondsLeft.value ? `Resend email in ${cooldown.secondsLeft.value} s` : 'Resend email'))
  return { resend, sending, label, waiting: computed(() => cooldown.secondsLeft.value > 0) }
}
