import type { CountryCode } from 'libphonenumber-js/min'
import { parsePhoneNumberFromString } from 'libphonenumber-js/min'
import * as v from 'valibot'

/**
 * Phone numbers (D127): stored in E.164 (`+85512345678`, ITU-T E.164: `+`, the country code, then
 * digits, at most 15), shown in international format (`+855 12 345 678`), checked against each
 * country's numbering plan with libphonenumber (Google's rules, the `libphonenumber-js` port; its
 * small "min" data). The form and the server use the same check. Adding a country is one line here.
 */
export const PHONE_COUNTRIES = [
  { code: 'KH', name: 'Cambodia', adjective: 'Cambodian', dialCode: '+855', icon: 'i-circle-flags-kh' },
  { code: 'HK', name: 'Hong Kong', adjective: 'Hong Kong', dialCode: '+852', icon: 'i-circle-flags-hk' },
  { code: 'AR', name: 'Argentina', adjective: 'Argentine', dialCode: '+54', icon: 'i-circle-flags-ar' },
] as const satisfies readonly { code: CountryCode, name: string, adjective: string, dialCode: string, icon: string }[]

export type PhoneCountry = typeof PHONE_COUNTRIES[number]['code']
export const DEFAULT_PHONE_COUNTRY: PhoneCountry = 'KH'

export const phoneCountryOf = (code: PhoneCountry) => PHONE_COUNTRIES.find(country => country.code === code)!
const isSupported = (code: string | undefined): code is PhoneCountry => PHONE_COUNTRIES.some(country => country.code === code)
const supportedNames = 'Cambodia, Hong Kong or Argentina'

export type PhoneResult
  = | {
    ok: true
    e164: string
    country: PhoneCountry
    /** Without the country code or the trunk 0: `12345678`. */
    national: string
    /** The same, grouped as written after the code: `12 345 678`, `9 11 1234 5678`. */
    local: string
  }
  | { ok: false, reason: 'invalid' | 'unsupported', message: string }

/**
 * Reads what a person typed or pasted: a local number for `country` (`012 345 678`, the leading 0
 * dropped), or a full one (`+855 12 345 678`, `00855…`, `855…`), whose country wins. Spaces, dashes,
 * dots and brackets are fine. Without `country`, only a full number (`+…`) is read: the server's case.
 */
export function parsePhone(input: string, country?: PhoneCountry): PhoneResult {
  const text = input.trim().replace(/^00(?=[1-9])/, '+')
  const parsed = parsePhoneNumberFromString(text, country ? { defaultCountry: country } : undefined)
  if (parsed && parsed.isValid()) {
    if (!isSupported(parsed.country)) return { ok: false, reason: 'unsupported', message: `Only ${supportedNames} numbers for now` }
    const local = parsed.formatInternational().slice(`+${parsed.countryCallingCode}`.length).trim()
    return { ok: true, e164: parsed.number, country: parsed.country, national: parsed.nationalNumber, local }
  }
  if (parsed?.country && !isSupported(parsed.country)) return { ok: false, reason: 'unsupported', message: `Only ${supportedNames} numbers for now` }
  return {
    ok: false,
    reason: 'invalid',
    message: country ? `Enter a valid ${phoneCountryOf(country).adjective} phone number` : `Enter a valid phone number from ${supportedNames}, starting with +`,
  }
}

/** `+85512345678` → `+855 12 345 678`; anything unreadable as it is. */
export function formatPhone(e164: string): string {
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164
}

/** A request's phone: a full number in a supported country, stored as E.164; blank (or `null`) clears it. */
export const phoneSchema = v.nullable(v.pipe(
  v.string(),
  v.trim(),
  v.maxLength(40, 'Not a phone number'),
  v.rawTransform(({ dataset, addIssue, NEVER }) => {
    if (!dataset.value) return null
    const result = parsePhone(dataset.value)
    if (result.ok) return result.e164
    addIssue({ message: result.message })
    return NEVER
  }),
))
