import { describe, expect, it } from 'vitest'
import { ApiError } from '../../app/utils/api-error'
import { generatePassword, isBreachedPassword, passwordRequirements } from '../../app/utils/password-requirements'

// The checklist under new-password fields (D210): the server's real rules, ticked while typing.

const states = (input: Parameters<typeof passwordRequirements>[0]) =>
  Object.fromEntries(passwordRequirements(input).map(r => [r.id, r.state]))

describe('password requirements', () => {
  it('lists the length, the match only on forms with a repeat, and the leaked-password check last with why', () => {
    expect(passwordRequirements({ password: '' }).map(r => r.label)).toEqual([
      'At least 8 characters',
      'Not a commonly used password',
    ])
    expect(passwordRequirements({ password: '', confirm: '' }).map(r => r.label)).toEqual([
      'At least 8 characters',
      'Repeat new password matches',
      'Not a commonly used password',
    ])
    expect(passwordRequirements({ password: '' }).at(-1)?.hint).toBe('Checked against passwords leaked from other websites, the first ones attackers try.')
  })

  it('ticks the length at 8 characters', () => {
    expect(states({ password: '' }).length).toBe('pending')
    expect(states({ password: '1234567' }).length).toBe('pending')
    expect(states({ password: '12345678' }).length).toBe('met')
  })

  it('ticks the match only when both entries are filled and equal', () => {
    expect(states({ password: '', confirm: '' }).match).toBe('pending')
    expect(states({ password: 'a long password', confirm: 'a long passwor' }).match).toBe('pending')
    expect(states({ password: 'a long password', confirm: 'a long password' }).match).toBe('met')
  })

  it('shows the live leaked-password check: checking, then ticked or red; pending without an answer', () => {
    expect(states({ password: 'a long password' }).leaked).toBe('pending')
    expect(states({ password: 'a long password', leak: 'checking' }).leaked).toBe('checking')
    expect(states({ password: 'a long password', leak: 'safe' }).leaked).toBe('met')
    expect(states({ password: 'password123', leak: 'leaked' }).leaked).toBe('failed')
    expect(states({ password: 'a long password', leak: 'unavailable' }).leaked).toBe('pending')
  })

  it('shows the server\'s refusal for the refused password, whatever the live check said', () => {
    expect(states({ password: 'password123', refused: 'password123', leak: 'safe' }).leaked).toBe('failed')
    expect(states({ password: 'password1234', refused: 'password123', leak: 'safe' }).leaked).toBe('met')
  })
})

describe('isBreachedPassword', () => {
  it('recognises Better Auth\'s PASSWORD_COMPROMISED answer only', () => {
    const answer = (code: string) => ApiError.fromResponse(400, { code, message: `server says ${code}` })
    expect(isBreachedPassword(answer('PASSWORD_COMPROMISED'))).toBe(true)
    expect(isBreachedPassword(answer('INVALID_PASSWORD'))).toBe(false)
    expect(isBreachedPassword(new Error('offline'))).toBe(false)
  })
})

describe('generatePassword', () => {
  it('makes four groups of five letters and digits, without look-alikes', () => {
    for (let i = 0; i < 200; i++) {
      expect(generatePassword()).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{5}(-[a-km-zA-HJ-NP-Z2-9]{5}){3}$/)
    }
  })

  it('is different every time and uses the whole alphabet', () => {
    const passwords = Array.from({ length: 500 }, generatePassword)
    expect(new Set(passwords).size).toBe(500)
    expect(new Set(passwords.join('').replaceAll('-', '')).size).toBe(57)
  })
})
