import { PASSWORD_MIN } from '#shared/contracts/identity'
import type { PasswordLeakCheck } from '~/composables/usePasswordLeakCheck'
import { ApiError } from './api-error'

/**
 * The checklist under every new-password field (D210): the rules the server enforces, in the words
 * a person can follow while typing. Only the real ones: Better Auth's length and Have I Been Pwned's
 * leaked-password check, no made-up composition rules. The leaked-password line is checked while
 * typing (`usePasswordLeakCheck`) and again by the server on save; it comes last, with a hint saying
 * why it's there. Over the maximum length is the field's own error, rare enough not to need a line.
 */
export type PasswordRequirementState = 'pending' | 'checking' | 'met' | 'failed'

export interface PasswordRequirement {
  id: 'length' | 'match' | 'leaked'
  label: string
  /** A line under the label: why the rule is there. */
  hint?: string
  state: PasswordRequirementState
}

export interface PasswordRequirementsInput {
  password: string
  /** The "Repeat new password" entry; leave it out on forms that have none. */
  confirm?: string
  /** The password the server last refused as leaked: retyping it shows the refusal again. */
  refused?: string
  /** The live check's answer for `password`. */
  leak?: PasswordLeakCheck
}

const LEAK_STATES: Record<PasswordLeakCheck, PasswordRequirementState> = {
  idle: 'pending',
  checking: 'checking',
  safe: 'met',
  leaked: 'failed',
  unavailable: 'pending',
}

export function passwordRequirements({ password, confirm, refused, leak = 'idle' }: PasswordRequirementsInput): PasswordRequirement[] {
  const requirements: PasswordRequirement[] = [
    { id: 'length', label: `At least ${PASSWORD_MIN} characters`, state: password.length >= PASSWORD_MIN ? 'met' : 'pending' },
  ]
  if (confirm !== undefined) {
    requirements.push({ id: 'match', label: 'Repeat new password matches', state: password && password === confirm ? 'met' : 'pending' })
  }
  requirements.push({
    id: 'leaked',
    label: 'Not a commonly used password',
    hint: 'Checked against passwords leaked from other websites, the first ones attackers try.',
    state: refused !== undefined && password === refused ? 'failed' : LEAK_STATES[leak],
  })
  return requirements
}

export const BREACHED_PASSWORD_MESSAGE = 'This password is too common. Choose another one.'

/** The server refused the new password as leaked (Better Auth's `haveIBeenPwned`). */
export function isBreachedPassword(error: unknown) {
  return ApiError.from(error).code === 'PASSWORD_COMPROMISED'
}

/** Letters and digits without look-alikes (0/O, 1/l/I), so a password read aloud or copied by hand survives. */
const PASSWORD_ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const GROUPS = 4
const GROUP_LENGTH = 5

/**
 * A strong random password for the Generate button (D210): four groups of five, like
 * `k7Rmq-Xa3vT-9pWez-Hn4Ld` (about 116 bits). From `crypto.getRandomValues`, with bytes past the
 * last whole run of the alphabet thrown away, so every character is equally likely.
 */
export function generatePassword(): string {
  const size = PASSWORD_ALPHABET.length
  const limit = 256 - (256 % size)
  const chars: string[] = []
  while (chars.length < GROUPS * GROUP_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      if (byte < limit && chars.length < GROUPS * GROUP_LENGTH) chars.push(PASSWORD_ALPHABET[byte % size]!)
    }
  }
  return Array.from({ length: GROUPS }, (_, i) => chars.slice(i * GROUP_LENGTH, (i + 1) * GROUP_LENGTH).join('')).join('-')
}

/**
 * Puts a value in an input the way typing (or a password manager) does: its `input` event updates
 * the `v-model` and the form's field, so validation runs and a server's error on it clears.
 */
export function fillInput(input: HTMLInputElement | null | undefined, value: string) {
  if (!input) return
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
