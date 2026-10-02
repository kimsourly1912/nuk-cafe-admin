import { describe, expect, it } from 'vitest'
import { buildKhqr, crc16, khqrAmount } from '#server/features/orders/khqr'

// QR texts made by the National Bank of Cambodia's JavaScript SDK (`bakong-khqr` 1.0.20,
// `generateIndividual`, its clock fixed at `now`, expiry 15 minutes later), each accepted by its
// `BakongKHQR.verify` at that time (D130). Ours must be byte for byte the same.
const BASE = { accountId: 'nukcafe@aclb', merchantName: 'NUK Cafe', merchantCity: 'Phnom Penh' }
const VECTORS = [
  {
    name: 'USD with cents',
    input: { currency: 'USD', amount: 450, billNumber: 'Order 042', storeLabel: 'Riverside', now: 1790000000000 },
    qr: '00020101021229160012nukcafe@aclb52045999530384054044.505802KH5908NUK Cafe6010Phnom Penh62260109Order 0420309Riverside993400131790000000000011317900009000006304BA52',
    md5: '0bac3b351290ee7e8119686208bd9976',
  },
  {
    name: 'USD whole dollars',
    input: { currency: 'USD', amount: 1200, billNumber: 'Order 007', storeLabel: 'Main branch', now: 1790000123456 },
    qr: '00020101021229160012nukcafe@aclb5204599953038405402125802KH5908NUK Cafe6010Phnom Penh62280109Order 0070311Main branch9934001317900001234560113179000102345663046485',
    md5: '63e44938ab76eeb512f3e4fe72f86188',
  },
  {
    name: 'USD two decimals',
    input: { currency: 'USD', amount: 875, billNumber: 'Order 999', storeLabel: 'Riverside', now: 1790000999999 },
    qr: '00020101021229160012nukcafe@aclb52045999530384054048.755802KH5908NUK Cafe6010Phnom Penh62260109Order 9990309Riverside9934001317900009999990113179000189999963048207',
    md5: '94b13f0eee80807c7763f4bdaf41312e',
  },
  {
    name: 'riel',
    input: { currency: 'KHR', amount: 35900, billNumber: 'Order 042', storeLabel: 'Riverside', now: 1790000000000 },
    qr: '00020101021229160012nukcafe@aclb5204599953031165405359005802KH5908NUK Cafe6010Phnom Penh62260109Order 0420309Riverside993400131790000000000011317900009000006304ED1E',
    md5: 'd974a04a7c3b303a8fb3ffe83253da82',
  },
] as const

describe('building a KHQR (D130)', () => {
  for (const vector of VECTORS) {
    it(`matches NBC's SDK: ${vector.name}`, () => {
      const { now, ...rest } = vector.input
      const result = buildKhqr({ ...BASE, ...rest, createdAt: new Date(now), expiresAt: new Date(now + 15 * 60_000) })
      expect(result).toEqual({ qr: vector.qr, md5: vector.md5 })
    })
  }

  it('writes amounts as the SDK does: riel whole, dollars whole or with two decimals', () => {
    expect(khqrAmount('USD', 5)).toBe('0.05')
    expect(khqrAmount('USD', 1050)).toBe('10.50')
    expect(khqrAmount('USD', 100000)).toBe('1000')
    expect(khqrAmount('KHR', 100)).toBe('100')
    expect(() => khqrAmount('USD', 0)).toThrow()
    expect(() => khqrAmount('KHR', 1.5)).toThrow()
  })

  it('checks with CRC-16/CCITT-FALSE ("123456789" gives 29B1)', () => {
    expect(crc16('123456789')).toBe('29B1')
  })
})
