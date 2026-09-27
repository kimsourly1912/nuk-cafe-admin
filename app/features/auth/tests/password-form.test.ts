import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { passwordFormSchema } from '../schemas/password-form'

const errors = (input: Record<string, string>) => {
  const result = v.safeParse(passwordFormSchema, input)
  return (result.success ? {} : v.flatten(result.issues).nested) ?? {}
}

describe('password form', () => {
  it('accepts a new password that differs, repeated exactly', () => {
    expect(errors({ currentPassword: 'Temp-1234-abcd', newPassword: 'my own password', confirmPassword: 'my own password' })).toEqual({})
  })

  it('needs every field', () => {
    expect(Object.keys(errors({ currentPassword: '', newPassword: '', confirmPassword: '' }))).toEqual(['currentPassword', 'newPassword', 'confirmPassword'])
  })

  it('needs 8 to 128 characters', () => {
    expect(errors({ currentPassword: 'x', newPassword: 'short', confirmPassword: 'short' })).toHaveProperty('newPassword', ['At least 8 characters'])
    const long = 'x'.repeat(129)
    expect(errors({ currentPassword: 'x', newPassword: long, confirmPassword: long })).toHaveProperty('newPassword', ['At most 128 characters'])
  })

  it('says when the repeat doesn\'t match', () => {
    expect(errors({ currentPassword: 'x', newPassword: 'my own password', confirmPassword: 'my own passwort' })).toEqual({ confirmPassword: ['The passwords don\'t match'] })
  })

  it('refuses keeping the current password', () => {
    expect(errors({ currentPassword: 'same password', newPassword: 'same password', confirmPassword: 'same password' })).toEqual({ newPassword: ['Choose a password different from the current one'] })
  })
})
