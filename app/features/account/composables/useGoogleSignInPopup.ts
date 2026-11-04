import { useAccountActions } from './useCustomerAccount'
import { googlePopupChannel, googleSignInError } from '../utils/google-sign-in'
import { ACCOUNT_PATHS } from '../utils/account'

/** The popup carries OAuth; only the still-mounted initiating form completes login. */
export function useGoogleSignInPopup() {
  const { googleSignIn, finishSignIn } = useAccountActions()
  const identity = useSessionIdentity()
  const assertActive = useAuthCompletion()
  const pending = ref(false)
  let cancel: (() => void) | undefined
  onScopeDispose(() => cancel?.())
  watch(identity.generation, () => cancel?.(), { flush: 'sync' })

  async function open(from?: unknown) {
    const startedIn = identity.generation.value
    const popupId = crypto.randomUUID()
    const channel = new BroadcastChannel(googlePopupChannel(popupId))
    // Open synchronously during the click, before browser checks or any network await.
    const popup = window.open('about:blank', '_blank', 'popup,width=500,height=700')
    if (!popup) {
      channel.close()
      throw new ApiError('Allow popups for this site, then try Continue with Google again.', { kind: 'business', status: 0 })
    }
    popup.document.title = 'Continue with Google'
    popup.document.body.textContent = 'Opening Google sign-in…'
    pending.value = true
    let timer: ReturnType<typeof setInterval> | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    let rejectWait: ((error: ApiError) => void) | undefined
    const abort = () => {
      popup.close()
      rejectWait?.(new ApiError('This sign-in is no longer current.', { kind: 'aborted', status: 0 }))
    }
    cancel = abort
    // Start observing immediately so closing during the initiation request also settles the UI.
    const completed = new Promise<void>((resolve, reject) => {
      rejectWait = reject
      channel.onmessage = (event: MessageEvent) => {
        const result = event.data
        if (event.origin !== window.location.origin || result?.path !== ACCOUNT_PATHS.googleCallback || result?.attempt !== popupId || result?.type !== 'google-complete') return
        channel.postMessage({ type: 'google-received', attempt: popupId })
        if (result.success === true) resolve()
        else reject(new ApiError(googleSignInError(result.error), { kind: 'business', status: 0 }))
      }
      timer = setInterval(() => {
        if (popup.closed) {
          reject(new ApiError('Google sign-in was closed. Try again when you are ready.', { kind: 'business', status: 0 }))
          return
        }
      }, 250)
      timeout = setTimeout(() => reject(new ApiError('Google sign-in timed out. Try again.', { kind: 'business', status: 0 })), 180_000)
    })
    try {
      const initiation = googleSignIn(from, popupId).then((destination) => {
        assertActive()
        identity.assertCurrent(startedIn)
        if (!popup.closed) popup.location.replace(destination)
      })
      await Promise.all([initiation, completed])
      assertActive()
      identity.assertCurrent(startedIn)
      await finishSignIn()
      assertActive()
      identity.assertCurrent(startedIn)
      // Stop cancellation only for our own successful identity transition.
      cancel = undefined
      await identity.change('login', 'account')
      assertActive()
    }
    finally {
      clearInterval(timer)
      clearTimeout(timeout)
      channel.close()
      cancel = undefined
      popup.close()
      pending.value = false
    }
  }

  return { open, pending }
}
