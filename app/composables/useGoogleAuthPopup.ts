import { ofetch } from 'ofetch'
import { GOOGLE_POPUP_FAILURES, googlePopupChannel, googlePopupFeatures, googleSignInError } from '~/utils/google-sign-in'
import type { SessionSurface } from './useSessionIdentity'

/**
 * The popup carries OAuth; only the still-mounted initiating form completes login.
 *
 * `popup.closed` is trusted only while the popup still shows our own blank page. Once it goes to
 * Google, a page with a strict Cross-Origin-Opener-Policy moves it to another browsing context
 * group and this handle reads `closed === true` while the window stays open (D261, 2026-11-06).
 * From then on only the callback's message, `cancel()` or the timeout settle the attempt.
 */
export function useGoogleAuthPopup({ start, finish, surface }: { start: (popupId: string) => Promise<string>, finish: () => Promise<void>, surface: SessionSurface }) {
  const identity = useSessionIdentity()
  const assertActive = useAuthCompletion()
  const pending = ref(false)
  let cancel: (() => void) | undefined
  onScopeDispose(() => cancel?.())
  let announcingGeneration: number | undefined
  watch(identity.generation, (generation) => {
    if (generation !== announcingGeneration) cancel?.()
  }, { flush: 'sync' })

  async function open() {
    const startedIn = identity.generation.value
    const popupId = crypto.randomUUID()
    const channel = new BroadcastChannel(googlePopupChannel(popupId))
    const failures = new BroadcastChannel(GOOGLE_POPUP_FAILURES)
    // Open synchronously during the click, before browser checks or any network await.
    const popup = window.open('about:blank', '_blank', googlePopupFeatures(window))
    if (!popup) {
      channel.close()
      failures.close()
      throw new ApiError('Allow popups for this site, then try Continue with Google again.', { kind: 'business', status: 0 })
    }
    popup.document.title = 'Continue with Google'
    popup.document.body.textContent = 'Opening Google sign-in…'
    pending.value = true
    let timer: ReturnType<typeof setInterval> | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    let rejectWait: ((error: ApiError) => void) | undefined
    // Set once the popup leaves our blank page: its handle may then report closed while it is open.
    let atProvider = false
    const abort = () => {
      popup.close()
      rejectWait?.(new ApiError('This sign-in is no longer current.', { kind: 'aborted', status: 0 }))
    }
    cancel = abort
    // Start observing immediately so closing during the initiation request also settles the UI.
    const completed = new Promise<'signed-in' | 'two-factor'>((resolve, reject) => {
      rejectWait = reject
      channel.onmessage = (event: MessageEvent) => {
        const result = event.data
        if (event.origin !== window.location.origin || result?.path !== '/google-callback' || result?.attempt !== popupId || result?.type !== 'google-complete') return
        channel.postMessage({ type: 'google-received', attempt: popupId })
        // Done with the window now; the session check and any workspace check happen on this page.
        popup.close()
        if (result.success === true) resolve(result.twoFactor === true ? 'two-factor' : 'signed-in')
        else reject(new ApiError(googleSignInError(result.error), { kind: 'business', status: 0 }))
      }
      // A failure on Better Auth's default error address: it has no attempt, and grants nothing.
      failures.onmessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin || event.data?.type !== 'google-failed') return
        reject(new ApiError(googleSignInError(undefined), { kind: 'business', status: 0 }))
      }
      timer = setInterval(() => {
        if (atProvider) return clearInterval(timer)
        if (popup.closed) reject(new ApiError('Google sign-in was closed. Try again when you are ready.', { kind: 'business', status: 0 }))
      }, 250)
      timeout = setTimeout(() => reject(new ApiError('Google sign-in timed out. Try again.', { kind: 'business', status: 0 })), 180_000)
    })
    try {
      const initiation = start(popupId).then((destination) => {
        assertActive()
        identity.assertCurrent(startedIn)
        // Closed on our own page: the poll, still running, reports it (unless a result came first).
        if (popup.closed) return
        atProvider = true
        popup.location.replace(destination)
      })
      const [, step] = await Promise.all([initiation, completed])
      assertActive()
      identity.assertCurrent(startedIn)
      if (step === 'two-factor') return step
      // The callback already set this browser's cookie. Another read on this page may observe the
      // new account first (a phone tab returning to view refreshes stale data): that is this
      // sign-in, not a competing one. The server's session decides, not the identity generation,
      // so this read is not discarded by that observation (like `useAuthRequest`'s auth writes).
      const session = await readSession()
      assertActive()
      if (!session?.user || session.user.isAnonymous) throw new ApiError('Sign in to continue.', { kind: 'unauthorized', status: 401 })
      // Announce the verified cookie before workspace authorization observes the new account.
      // This also clears the old identity when the account belongs to another workspace.
      const authenticatedIn = identity.generation.value + 1
      announcingGeneration = authenticatedIn
      try {
        await identity.change('login', surface)
      }
      finally {
        announcingGeneration = undefined
      }
      assertActive()
      identity.assertCurrent(authenticatedIn)
      await finish()
      assertActive()
      identity.assertCurrent(authenticatedIn)
      return 'signed-in' as const
    }
    finally {
      clearInterval(timer)
      clearTimeout(timeout)
      channel.close()
      failures.close()
      cancel = undefined
      popup.close()
      pending.value = false
    }
  }

  /** The person gave up: closes the popup if this page can still reach it, and shows no error. */
  function cancelAttempt() {
    cancel?.()
  }

  return { open, pending, cancel: cancelAttempt }
}

async function readSession() {
  try {
    return await ofetch<{ user?: { isAnonymous?: boolean } } | null>('/api/auth/get-session', { retry: 0, timeout: 30_000 })
  }
  catch (error) {
    throw ApiError.from(error)
  }
}
