/** Only these password/account-email actions require a browser token (D217). */
const actions = {
  '/sign-in/email': 'sign_in',
  '/sign-up/email': 'sign_up',
  '/request-password-reset': 'password_reset',
  '/send-verification-email': 'verify_email',
} as const

export type HumanCheckAction = (typeof actions)[keyof typeof actions]
export const HUMAN_CHECK_HEADER = 'x-captcha-response'

export function humanCheckAction(path: string): HumanCheckAction | undefined {
  return Object.hasOwn(actions, path) ? actions[path as keyof typeof actions] : undefined
}
