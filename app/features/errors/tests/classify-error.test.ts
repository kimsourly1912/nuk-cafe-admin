import { CAFE_NOT_FOUND, TENANT_SUSPENDED } from '#shared/contracts/cafe'
import { describe, expect, it } from 'vitest'
import { classifyError } from '../utils/classify-error'
import { errorCopy } from '../utils/error-copy'

describe('classifyError', () => {
  it('names a missing or paused cafe only when the address has a cafe', () => {
    expect(classifyError({ statusCode: 404, data: { code: CAFE_NOT_FOUND } }, 'nuk')).toBe('cafe-not-found')
    expect(classifyError({ statusCode: 403, data: { code: TENANT_SUSPENDED } }, 'nuk')).toBe('cafe-paused')
    expect(classifyError({ statusCode: 404, data: { code: CAFE_NOT_FOUND } }, undefined)).toBe('page-not-found')
    expect(classifyError({ statusCode: 403, data: { code: TENANT_SUSPENDED } }, undefined)).toBe('generic')
  })

  it('reads the code from JSON text, as after a server render', () => {
    expect(classifyError({ statusCode: 404, data: JSON.stringify({ code: CAFE_NOT_FOUND }) }, 'nuk')).toBe('cafe-not-found')
    expect(classifyError({ statusCode: 404, data: 'not json' }, 'nuk')).toBe('page-not-found')
  })

  it('treats any other 404 as an unknown page and anything else as generic', () => {
    expect(classifyError({ statusCode: 404 }, 'nuk')).toBe('page-not-found')
    expect(classifyError({ statusCode: 500 }, 'nuk')).toBe('generic')
  })
})

describe('errorCopy', () => {
  const ctx = { workspace: false, cafeName: '', message: 'Boom' }

  it('words a paused cafe for its staff and for customers', () => {
    expect(errorCopy('cafe-paused', { ...ctx, cafeName: 'Moon', workspace: true })).toMatchObject({ title: 'This cafe is paused' })
    expect(errorCopy('cafe-paused', { ...ctx, cafeName: 'Moon' })).toMatchObject({ title: 'Ordering is paused', description: 'Moon isn\'t taking orders at the moment. Please try again later.' })
    expect(errorCopy('cafe-paused', ctx).description).toContain('This cafe')
  })

  it('shows the error message for a generic error', () => {
    expect(errorCopy('generic', ctx)).toMatchObject({ title: 'Something went wrong', description: 'Boom' })
  })
})
