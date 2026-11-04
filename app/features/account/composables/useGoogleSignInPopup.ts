import { useGoogleAuthPopup } from '~/composables/useGoogleAuthPopup'
import { useAccountActions } from './useCustomerAccount'

export function useGoogleSignInPopup() {
  const { googleSignIn, finishSignIn } = useAccountActions()
  return useGoogleAuthPopup({ start: googleSignIn, finish: finishSignIn, surface: 'account' })
}
