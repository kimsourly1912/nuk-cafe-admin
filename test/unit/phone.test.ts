import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { updateBranchSettingsSchema } from '../../shared/contracts/branches'
import { formatPhone, parsePhone } from '../../shared/contracts/phone'

// Phone numbers (D127): E.164 stored, each country's numbering plan checked by libphonenumber.

describe('reading a phone number', () => {
  it('reads a local number for the chosen country, dropping the trunk 0 and separators', () => {
    expect(parsePhone('012 345 678', 'KH')).toEqual({ ok: true, e164: '+85512345678', country: 'KH', national: '12345678', local: '12 345 678' })
    expect(parsePhone('12-345-678', 'KH')).toMatchObject({ ok: true, e164: '+85512345678' })
    expect(parsePhone('(097) 1234 567', 'KH')).toMatchObject({ ok: true, e164: '+855971234567' })
    expect(parsePhone('9123 4567', 'HK')).toMatchObject({ ok: true, e164: '+85291234567', country: 'HK' })
  })

  it('takes a full number\'s own country over the chosen one: +, 00, or the code without +', () => {
    expect(parsePhone('+852 9123 4567', 'KH')).toMatchObject({ ok: true, country: 'HK', national: '91234567', local: '9123 4567' })
    expect(parsePhone('00855 12 345 678', 'HK')).toMatchObject({ ok: true, country: 'KH', e164: '+85512345678' })
    expect(parsePhone('85512345678', 'KH')).toMatchObject({ ok: true, e164: '+85512345678' })
  })

  it('writes Argentine mobiles with the 9 after +54, however they were typed', () => {
    expect(parsePhone('011 15-1234-5678', 'AR')).toMatchObject({ ok: true, e164: '+5491112345678' })
    expect(parsePhone('+54 9 11 1234 5678')).toMatchObject({ ok: true, e164: '+5491112345678', local: '9 11 1234 5678' })
    expect(parsePhone('11 1234-5678', 'AR')).toMatchObject({ ok: true, e164: '+541112345678' })
  })

  it('refuses a number too short or too long for the country, naming it', () => {
    expect(parsePhone('1234', 'KH')).toEqual({ ok: false, reason: 'invalid', message: 'Enter a valid Cambodian phone number' })
    expect(parsePhone('9123 45678 9', 'HK')).toMatchObject({ ok: false, message: 'Enter a valid Hong Kong phone number' })
    expect(parsePhone('abc', 'AR')).toMatchObject({ ok: false, message: 'Enter a valid Argentine phone number' })
  })

  it('refuses a country not supported yet', () => {
    expect(parsePhone('+1 202 555 0143', 'KH')).toEqual({ ok: false, reason: 'unsupported', message: 'Only Cambodia, Hong Kong or Argentina numbers for now' })
  })

  it('without a country (the server) reads only a full number', () => {
    expect(parsePhone('+85512345678')).toMatchObject({ ok: true })
    expect(parsePhone('012 345 678')).toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('shows a stored number in international format', () => {
    expect(formatPhone('+85512345678')).toBe('+855 12 345 678')
    expect(formatPhone('+5491112345678')).toBe('+54 9 11 1234 5678')
    expect(formatPhone('call the front desk')).toBe('call the front desk')
  })
})

describe('the branch settings request', () => {
  const parse = (phone: unknown) => v.safeParse(updateBranchSettingsSchema, { version: 1, phone })

  it('stores a full number as E.164, and blank or null as no phone', () => {
    expect(parse('+855 12 345 678').output).toMatchObject({ phone: '+85512345678' })
    expect(parse('  ').output).toMatchObject({ phone: null })
    expect(parse(null).output).toMatchObject({ phone: null })
  })

  it('refuses a local number, an invalid one or another country\'s, on the phone field', () => {
    for (const phone of ['012 345 678', '+855 1234', '+1 202 555 0143']) {
      const result = parse(phone)
      expect(result.success, phone).toBe(false)
      expect(v.flatten<typeof updateBranchSettingsSchema>(result.issues!).nested?.phone, phone).toBeDefined()
    }
  })
})
