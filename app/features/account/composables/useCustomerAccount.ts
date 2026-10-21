import { useIntervalFn } from '@vueuse/core'
import type { CustomerAccount, GuestCustomer, ShopMe } from '#shared/contracts/account'
import type { ForgotPasswordForm, SignInForm, SignUpForm } from '../schemas/account-form'
import { ACCOUNT_PATHS } from '../utils/account'

/**
 * The customer's account on the customer site (step 5.2, D97): who is signed in, from
 * `GET /api/shop/me`, and the Better Auth calls behind the account pages. The admin has its own
 * (`useAuth`, D52); both read the same browser session (one sign-in per browser, D97).
 *
 * Read in the browser only (`server: false`): server-rendered pages are the same for everyone, and
 * the header shows a placeholder until the browser knows (D97). Signed out is `null`, not an error.
 *
 * `account` is a real account; a guest (D156: signed in by Place order, no email or password) is
 * `guest` instead, so everything account-shaped (the initials, the member code, the verify banner)
 * treats a guest as signed out.
 */
export function useCustomerAccount() {
  const query = useApiQuery('account:me', loadAccount, { server: false, default: () => null })
  const account = computed<CustomerAccount | null>(() => (query.data.value && !query.data.value.guest ? query.data.value : null))
  const guest = computed<GuestCustomer | null>(() => (query.data.value?.guest ? query.data.value : null))
  /** The first answer arrived (signed in or not); stays true while it's refetched. */
  const known = useState('account:known', () => false)
  watch(query.status, (status) => {
    if (status === 'success' || status === 'error') known.value = true
  }, { immediate: true })
  return { account, guest, known, error: query.error, refresh: query.refresh }
}

/** The server's code for an account that must replace its temporary password first. */
const PASSWORD_CHANGE_REQUIRED = 'PASSWORD_CHANGE_REQUIRED'

/** The part of Better Auth's user (sign-in, `get-session`) the store reads. */
interface AuthUser {
  /** A staff account on its temporary password (security.md → Staff onboarding). */
  mustChangePassword?: boolean | null
}

/**
 * Signed out is Better Auth's `get-session` answering `null` (no failed request in the console on
 * every visit); only a session reads the account itself.
 *
 * A staff account still on its temporary password counts as signed out on the store: every route
 * but `/api/auth` refuses it (PASSWORD_CHANGE_REQUIRED) and only its workspace can change the
 * password. It isn't signed out, since the same session may be on the change-password page in
 * another tab (one sign-in per browser, D97).
 */
async function loadAccount(): Promise<ShopMe | null> {
  const session = await fetchSession()
  if (!session?.user || session.user.mustChangePassword) return null
  try {
    return await apiFetch<ShopMe>('/shop/me')
  }
  catch (error) {
    // Signed out, or given a temporary password, between the two requests.
    const apiError = ApiError.from(error)
    if (apiError.kind === 'unauthorized' || apiError.code === PASSWORD_CHANGE_REQUIRED) return null
    throw error
  }
}

/** This browser's Better Auth session, `null` when signed out. */
async function fetchSession() {
  try {
    return await $fetch<{ user: AuthUser } | null>('/api/auth/get-session', { retry: 0, timeout: 30_000 })
  }
  catch (error) {
    throw ApiError.from(error)
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
  /**
   * Signs in: the password step. `two-factor` (D188): the page asks for the code, then calls
   * `finishSignIn`. A staff account on its temporary password is refused (see `loadAccount`):
   * signed out again, like the workspaces' sign-ins do with an account they don't let in, so the
   * menu isn't left with a session it can't use.
   */
  async function signIn(form: SignInForm): Promise<PasswordStep> {
    const response = await authFetch<{ user?: AuthUser, twoFactorRedirect?: boolean }>('/sign-in/email', { email: form.email, password: form.password })
    if (passwordStepOf(response) === 'two-factor') return 'two-factor'
    await signedIn(response.user!)
    return 'signed-in'
  }

  /** Signed in by the code after the password: the same checks as a password-only sign-in. */
  async function finishSignIn() {
    const session = await fetchSession()
    if (!session) throw new ApiError('Sign in to continue.', { kind: 'unauthorized', status: 401 })
    await signedIn(session.user)
  }

  async function signedIn(user: AuthUser) {
    if (user.mustChangePassword) {
      await authFetch('/sign-out').catch(() => {})
      await accountChanged()
      throw new ApiError('Change your temporary password to continue.', { kind: 'forbidden', status: 403, code: PASSWORD_CHANGE_REQUIRED })
    }
    await accountChanged()
  }

  /** Creates the account and signs in; Better Auth sends the verification email (via the outbox). */
  async function signUp(form: SignUpForm) {
    await authFetch('/sign-up/email', { name: form.name, email: form.email, password: form.password, callbackURL: VERIFY_CALLBACK })
    await accountChanged()
  }

  /**
   * Signs this browser in as a guest (D156), for Place order without an account. The orders it
   * places are the guest's; signing in or up later moves them to the account.
   */
  async function signInAsGuest() {
    await authFetch('/sign-in/anonymous')
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

  return { signIn, finishSignIn, signUp, signInAsGuest, signOut, resendVerification, requestPasswordReset, resetPassword }
}

/** Seconds between two emails of the same kind (the server allows about 3 per 10 minutes). */
export const RESEND_COOLDOWN_SECONDS = 60

/**
 * A wait before the same email can be sent again, shared by every place that offers it (the banner,
 * the account menu, the pages) so one countdown is shown. Kept for this tab only.
 *
 * The clock ticks only while a wait runs: the banner is on every menu page, so an always-on timer
 * would run for every visitor.
 */
export function useResendCooldown(kind: 'verify' | 'reset') {
  const until = useState(`account:cooldown:${kind}`, () => 0)
  const now = shallowRef(Date.now())
  const clock = useIntervalFn(() => {
    now.value = Date.now()
    if (now.value >= until.value) clock.pause()
  }, 1000, { immediate: false })
  watch(until, (value) => {
    now.value = Date.now()
    if (value > now.value) clock.resume()
  }, { immediate: true })

  const secondsLeft = computed(() => Math.max(0, Math.ceil((until.value - now.value) / 1000)))
  const waiting = computed(() => secondsLeft.value > 0)

  function start() {
    until.value = Date.now() + RESEND_COOLDOWN_SECONDS * 1000
  }

  /** The send button's label: "Resend email", or "Resend email in 42 s" while waiting. */
  function waitLabel(action: string) {
    return waiting.value ? `${action} in ${secondsLeft.value} s` : action
  }

  return { waiting, start, waitLabel }
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
    if (!email || sending.value || cooldown.waiting.value) return
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

  const label = computed(() => cooldown.waitLabel('Resend email'))
  return { resend, sending, label, waiting: cooldown.waiting }
}
