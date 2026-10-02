import { md5 } from '@noble/hashes/legacy.js'
import { bytesToHex } from '@noble/hashes/utils.js'

/**
 * Builds a dynamic KHQR (step 10.15, D130): the National Bank of Cambodia's payment QR on EMVCo's
 * merchant-presented format, for an individual Bakong account (tag 29). Tags, their order and the
 * CRC follow NBC's JavaScript SDK (`bakong-khqr` 1.0.20); `tests/khqr.test.ts` holds QR texts that
 * SDK made, so any difference fails. Each field is `tag + 2-digit length + value`; the text ends
 * with tag 63, its length 04 and a CRC-16/CCITT-FALSE of everything before it, in hex.
 *
 * Pure: the caller passes the time, so the same input gives the same QR. The MD5 of the QR text is
 * what Bakong's check API looks payments up by (10.15b).
 */

/** ISO 4217 numeric codes: the two currencies KHQR takes. */
export const KHQR_CURRENCY_CODES = { USD: '840', KHR: '116' } as const
export type KhqrCurrency = keyof typeof KHQR_CURRENCY_CODES

/** The SDK's limits (its `INVALID_LENGTH`). */
export const KHQR_LIMITS = { accountId: 32, merchantName: 25, merchantCity: 15, billNumber: 25, storeLabel: 25 } as const

export interface KhqrInput {
  /** The receiver's Bakong ID: `name@bank`. */
  accountId: string
  merchantName: string
  merchantCity: string
  currency: KhqrCurrency
  /** Cents for USD, riel for KHR. */
  amount: number
  billNumber: string
  storeLabel: string
  createdAt: Date
  expiresAt: Date
}

export interface Khqr {
  qr: string
  md5: string
}

function field(tag: string, value: string): string {
  if (value.length > 99) throw new Error(`KHQR tag ${tag} is longer than 99 characters`)
  return `${tag}${String(value.length).padStart(2, '0')}${value}`
}

/** The amount as the SDK writes it: riel whole; dollars whole ("12") or with two decimals ("4.50"). */
export function khqrAmount(currency: KhqrCurrency, amount: number): string {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('A KHQR amount is a positive whole number of cents or riel')
  if (currency === 'KHR') return String(amount)
  const dollars = Math.floor(amount / 100)
  const cents = amount % 100
  return cents === 0 ? String(dollars) : `${dollars}.${String(cents).padStart(2, '0')}`
}

/** CRC-16/CCITT-FALSE (polynomial 0x1021, start 0xFFFF) over the UTF-8 bytes, as 4 hex digits. */
export function crc16(text: string): string {
  let crc = 0xFFFF
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte << 8
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

export function buildKhqr(input: KhqrInput): Khqr {
  const account = field('00', input.accountId)
  const additional = field('01', input.billNumber) + field('03', input.storeLabel)
  const timestamps = field('00', String(input.createdAt.getTime())) + field('01', String(input.expiresAt.getTime()))
  const body = [
    field('00', '01'), // payload format indicator
    field('01', '12'), // point of initiation: dynamic (an amount)
    field('29', account), // an individual Bakong account
    field('52', '5999'), // merchant category: the SDK's default
    field('53', KHQR_CURRENCY_CODES[input.currency]),
    field('54', khqrAmount(input.currency, input.amount)),
    field('58', 'KH'),
    field('59', input.merchantName),
    field('60', input.merchantCity),
    field('62', additional),
    field('99', timestamps),
  ].join('')
  const withCrcTag = `${body}6304`
  const qr = withCrcTag + crc16(withCrcTag)
  return { qr, md5: bytesToHex(md5(new TextEncoder().encode(qr))) }
}
