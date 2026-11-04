import { useIntervalFn } from '@vueuse/core'
import type { CustomerAccount, DeleteAccountInput, GuestCustomer, ShopMe } from '#shared/contracts/account'
import type { ChangePasswordTarget } from '~/utils/account-cafes'
import type { ForgotPasswordForm, SignInForm, SignUpForm } from '../schemas/account-form'
import { ACCOUNT_PATHS, accountLink, TemporaryPasswordError } from '../utils/account'

/**
 * The customer's account on the customer site (step 5.2, D97): who is signed in, from
 * `GET /api/shop/me`, and the Better Auth calls behind the account pages. The admin has its own
 * (`useAuth`, D52); both read the same browser session (one sign-in per browser, D97).
 *
 * Read in the browser only (`server: false`): server-rendered pages are the same for everyone, and
 * the header shows a placeholder until the browser knows (D97). Signed out is `null`, not an error.
 * A session change (sign-out, another account) clears it like every query (D29).
 *
 * `account` is a real account; a guest (D156: signed in by Place order, no email or password) is
 * `guest` instead, so everything account-shaped (the initials, the member code, the verify banner)
 * treats a guest as signed out.
 */
export function useCustomerAccount() {
  const identity = useSessionIdentity()
  // Kept between pages (D173): back from a workspace without the header, it shows the account at
  // once instead of "Sign in" until a reload answers. Its own changes refresh it (`invalidate`).
  const query = useApiQuery('account:me', async () => ({ account: await loadAccount(identity) }), { server: false, default: () => null, staleTime: REFERENCE_STALE_TIME })
  const account = computed<CustomerAccount | null>(() => (query.data.value?.account && !query.data.value.account.guest ? query.data.value.account : null))
  const guest = computed<GuestCustomer | null>(() => (query.data.value?.account?.guest ? query.data.value.account : null))
  /** The first answer arrived (signed in or not); stays true while it's refetched. */
  const known = computed(() => query.data.value != null)
  return { account, guest, known, error: query.error, refresh: query.refresh }
}

/** Who is signed in, without any cafe's profile: what the platform's account pages show. */
export interface AccountIdentity {
  name: string
  email: string
  emailVerified: boolean
}

/**
 * The signed-in account on the platform's account pages (`/sign-in`, `/sign-up`, `/verify-email`,
 * `/email-verified`; D221). Their address names no cafe, so they read Better Auth's session only,
 * never a cafe's `/shop/me`: reading that would make the person a member of a cafe they didn't
 * open. `null` when signed out, for a guest (D156) and on a temporary password, as on the store.
 */
export function useAccountSession(options: { fresh?: boolean } = {}) {
  const identity = useSessionIdentity()
  const query = useApiQuery('account:session', async () => ({ account: await loadIdentity(identity) }), { server: false, default: () => null, staleTime: REFERENCE_STALE_TIME })
  const ready = ref(!options.fresh)
  if (options.fresh) {
    const hadAnswer = query.data.value != null
    onMounted(async () => {
      if (hadAnswer) query.clear()
      if (query.data.value == null) await query.refresh({ dedupe: 'defer' })
      ready.value = true
    })
  }
  const known = computed(() => ready.value && query.data.value != null)
  return { account: computed(() => query.data.value?.account ?? null), known, error: computed(() => ready.value ? query.error.value : undefined), refresh: query.refresh }
}

async function loadIdentity(identity: ReturnType<typeof useSessionIdentity>): Promise<AccountIdentity | null> {
  const user = (await fetchSession())?.user
  identity.observe(user?.isAnonymous ? null : user?.id ?? user?.email ?? null, 'account')
  if (!user || user.mustChangePassword || user.isAnonymous) return null
  return { name: user.name, email: user.email, emailVerified: Boolean(user.emailVerified) }
}

/** The server's code for an account that must replace its temporary password first. */
const PASSWORD_CHANGE_REQUIRED = 'PASSWORD_CHANGE_REQUIRED'

/** The part of Better Auth's user (sign-in, `get-session`) the store reads. */
interface AuthUser {
  id?: string
  name: string
  email: string
  emailVerified?: boolean | null
  /** A guest (D156): signed in by Place order, no email or password of their own. */
  isAnonymous?: boolean | null
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
async function loadAccount(identity: ReturnType<typeof useSessionIdentity>): Promise<ShopMe | null> {
  const session = await fetchSession()
  identity.observe(session?.user.isAnonymous ? null : session?.user.id ?? session?.user.email ?? null, 'account')
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
    return await apiFetch<{ user: AuthUser } | null>('/auth/get-session')
  }
  catch (error) {
    throw ApiError.from(error)
  }
}

/**
 * Where the verification link lands (`?error=` when it doesn't work), carrying the cafe page the
 * person came from (`?redirect=`, checked again on arrival): "Back to the menu" there goes back to
 * that cafe, never to a guessed one (D221).
 */
function verifyCallback(from?: unknown): string {
  const link = accountLink(ACCOUNT_PATHS.emailVerified, from)
  return typeof link === 'string' ? link : `${link.path}?${new URLSearchParams(link.query)}`
}
/** Where the reset link lands (`?token=`, or `?error=INVALID_TOKEN`). */

/** Refetch the account here and in the site's other tabs. */
const accountChanged = () => invalidate('account')

/**
 * The account actions. Each throws `ApiError`; the pages turn it into words
 * (`accountFormError`) and keep their own `saving` state, like the admin's sign-in (D84).
 */
export function useAccountActions() {
  const authFetch = useAuthRequest()
  const identity = useSessionIdentity()
  /**
   * Signs in: the password step. `two-factor` (D188): the page asks for the code, then calls
   * `finishSignIn`. A staff account on its temporary password can't use the store (see
   * `loadAccount`): it stays signed in and the page links to its workspace's change-password page
   * (`TemporaryPasswordError`, Q3, D241). With no workspace to send it to, or when that can't be
   * checked, it's signed out again, so the menu isn't left with a session it can't use.
   */
  /** Starts OAuth only; the caller verifies the completed session before announcing login. */
  async function googleSignIn(from?: unknown, popupId?: string) {
    const link = accountLink(ACCOUNT_PATHS.signIn, from)
    const callback = typeof link === 'string' ? link : `${link.path}?${new URLSearchParams(link.query)}`
    const success = new URL(popupId ? ACCOUNT_PATHS.googleCallback : callback, window.location.origin)
    if (popupId) success.searchParams.set('googlePopup', popupId)
    const failure = new URL(success)
    success.searchParams.set('google', '1')
    const result = await authFetch<{ url?: string }>('/sign-in/social', {
      provider: 'google',
      disableRedirect: true,
      callbackURL: success.toString(),
      errorCallbackURL: failure.toString(),
    })
    // Never navigate to a URL supplied by a query string or an unrecognised upstream origin.
    const destination = result.url ? new URL(result.url) : null
    if (destination?.origin !== 'https://accounts.google.com') {
      throw new ApiError('Google sign-in is unavailable. Try again shortly.', { kind: 'business', status: 0 })
    }
    return destination.toString()
  }

  async function signIn(form: SignInForm): Promise<PasswordStep> {
    const response = await authFetch<{ user?: AuthUser, twoFactorRedirect?: boolean }>('/sign-in/email', { email: form.email, password: form.password })
    if (passwordStepOf(response) === 'two-factor') return 'two-factor'
    await signedIn(response.user!)
    return 'signed-in'
  }

  /** Signed in by the code after the password: the same checks as a password-only sign-in. */
  async function finishSignIn() {
    const session = await fetchSession()
    if (!session || session.user.isAnonymous) throw new ApiError('Sign in to continue.', { kind: 'unauthorized', status: 401 })
    await signedIn(session.user)
  }

  async function signedIn(user: AuthUser) {
    if (user.mustChangePassword) {
      let target: ChangePasswordTarget | null = null
      try {
        target = await changePasswordTarget()
      }
      catch {
        // Couldn't check where: signed out with the general message below.
      }
      if (target) {
        throw new TemporaryPasswordError(target)
      }
      await authFetch('/sign-out').catch(() => {})
      await identity.change('logout')
      throw new ApiError('Change your temporary password to continue.', { kind: 'forbidden', status: 403, code: PASSWORD_CHANGE_REQUIRED })
    }
  }

  /**
   * Creates the account and signs in; Better Auth sends the verification email (via the outbox).
   * `from`: the cafe page the email's link comes back to.
   */
  async function signUp(form: SignUpForm, from?: unknown) {
    await authFetch('/sign-up/email', { name: form.name, email: form.email, password: form.password, callbackURL: verifyCallback(from) })
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
    const startedIn = identity.generation.value
    try {
      await authFetch('/sign-out')
    }
    catch (error) {
      if (ApiError.from(error).kind === 'aborted') throw error
      await identity.change('logout')
      throw error
    }
    identity.assertCurrent(startedIn)
    await identity.change('logout')
  }

  async function resendVerification(email: string, from?: unknown) {
    await authFetch('/send-verification-email', { email, callbackURL: verifyCallback(from) })
  }

  /** Answers the same whether or not the email has an account. */
  async function requestPasswordReset(form: ForgotPasswordForm, from?: unknown) {
    const link = accountLink(ACCOUNT_PATHS.resetPassword, from)
    const redirectTo = typeof link === 'string' ? link : `${link.path}?${new URLSearchParams(link.query)}`
    await authFetch('/request-password-reset', { email: form.email, redirectTo })
  }

  /** Sets the new password; Better Auth signs the account out everywhere (D51). */
  async function resetPassword(token: string, newPassword: string) {
    await authFetch('/reset-password', { token, newPassword })
    await identity.change('logout')
  }

  return { googleSignIn, signIn, finishSignIn, signUp, signInAsGuest, signOut, resendVerification, requestPasswordReset, resetPassword }
}

/**
 * The account deletes itself, in every cafe (D237): `POST /api/me/delete-account` with its password.
 * The server ends every session, so on success the site forgets the account like a sign-out does.
 * A refusal (wrong password, still working at a cafe, an order in progress) is the dialog's to show.
 */
export function useDeleteAccount(onDeleted: () => void) {
  const identity = useSessionIdentity()
  return useMutation(
    async (input: DeleteAccountInput) => {
      const result = await apiFetch<null>('/me/delete-account', { method: 'POST', body: input })
      // Resolve this modal's successful result before the boundary closes remaining overlays.
      onDeleted()
      await identity.change('logout')
      return result
    },
    {
      id: 'account:delete',
      successMessage: 'Your account was deleted',
      errorMessage: 'Couldn\'t delete your account',
    },
  )
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
  const route = useRoute()
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
      // The header's banner and account menu are on a cafe's pages: the link comes back to this one.
      await resendVerification(email, route.fullPath)
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
