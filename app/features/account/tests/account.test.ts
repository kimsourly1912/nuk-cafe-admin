import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { ApiError } from '~/utils/api-error'
import { signInSchema, signUpSchema } from '../schemas/account-form'
import { accountFormError, accountLink, accountRedirectTarget, initialsOf, isDeadLink } from '../utils/account'

describe('accountRedirectTarget', () => {
  it('returns to a page of the customer site, query and hash kept', () => {
    expect(accountRedirectTarget('/table/abc?x=1#top')).toBe('/table/abc?x=1#top')
    expect(accountRedirectTarget('/')).toBe('/')
  })

  it('never leaves the site: other hosts, backslashes, non-paths', () => {
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', 'evil', '', undefined, ['/'], 42]) {
      expect(accountRedirectTarget(bad)).toBe('/')
    }
  })

  it('never goes to the admin or back to a sign-in or password page', () => {
    for (const bad of ['/admin', '/admin/products', '/sign-in', '/sign-up?redirect=/x', '/reset-password']) {
      expect(accountRedirectTarget(bad)).toBe('/')
    }
    expect(accountRedirectTarget('/administrator')).toBe('/administrator')
    expect(accountRedirectTarget('/verify-email')).toBe('/verify-email')
  })
})

describe('accountLink', () => {
  it('carries the page to come back to, but not the menu', () => {
    expect(accountLink('/sign-in', '/table/abc')).toEqual({ path: '/sign-in', query: { redirect: '/table/abc' } })
    expect(accountLink('/sign-in', '/')).toBe('/sign-in')
    expect(accountLink('/sign-up', '//evil.example')).toBe('/sign-up')
  })
})

describe('initialsOf', () => {
  it('first and last word, one word, or the email', () => {
    expect(initialsOf('Sokha Chan', 's@x.io')).toBe('SC')
    expect(initialsOf('  sokha   de la chan ', 's@x.io')).toBe('SC')
    expect(initialsOf('Sokha', 's@x.io')).toBe('S')
    expect(initialsOf('', 'kim@x.io')).toBe('K')
  })
})

const betterAuthError = (status: number, code: string) => ApiError.fromResponse(status, { code, message: `server says ${code}` })

describe('accountFormError', () => {
  it('a wrong email or password is one message, on neither field', () => {
    expect(accountFormError(betterAuthError(401, 'INVALID_EMAIL_OR_PASSWORD'))).toEqual({ message: 'Wrong email or password.' })
  })

  it('puts field problems on their field', () => {
    expect(accountFormError(betterAuthError(422, 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL')).field).toBe('email')
    expect(accountFormError(betterAuthError(400, 'PASSWORD_COMPROMISED'))).toEqual({ field: 'password', message: 'This password has appeared in a data breach. Choose another one.' })
    expect(accountFormError(betterAuthError(400, 'PASSWORD_TOO_SHORT')).field).toBe('password')
  })

  it('too many tries, and anything else as the server or the kind words it', () => {
    expect(accountFormError(ApiError.fromResponse(429, {}))).toEqual({ message: 'Too many tries. Try again in a few minutes.' })
    expect(accountFormError(ApiError.fromResponse(500, {})).field).toBeUndefined()
  })
})

describe('isDeadLink', () => {
  it('expired or invalid tokens, from a redirect or an answer', () => {
    expect(isDeadLink('TOKEN_EXPIRED')).toBe(true)
    expect(isDeadLink('INVALID_TOKEN')).toBe(true)
    expect(isDeadLink(betterAuthError(400, 'INVALID_TOKEN'))).toBe(true)
    expect(isDeadLink(betterAuthError(400, 'PASSWORD_TOO_SHORT'))).toBe(false)
  })
})

const messages = (schema: v.GenericSchema, value: unknown) => {
  const result = v.safeParse(schema, value)
  return result.success ? [] : result.issues.map(issue => `${v.getDotPath(issue)}: ${issue.message}`)
}

describe('account forms', () => {
  it('sign in: a valid email and any password', () => {
    expect(messages(signInSchema, { email: ' sokha@example.com ', password: 'x' })).toEqual([])
    expect(messages(signInSchema, { email: 'sokha@', password: '' })).toEqual(['email: Enter a valid email address', 'password: Password is required'])
  })

  it('sign up: a name, and 8 to 128 characters of password', () => {
    expect(messages(signUpSchema, { name: 'Sokha', email: 'sokha@example.com', password: '12345678' })).toEqual([])
    expect(messages(signUpSchema, { name: '  ', email: 'sokha@example.com', password: '1234567' })).toEqual(['name: Name is required', 'password: At least 8 characters'])
    expect(messages(signUpSchema, { name: 'S', email: 'sokha@example.com', password: 'x'.repeat(129) })).toEqual(['password: At most 128 characters'])
  })
})
