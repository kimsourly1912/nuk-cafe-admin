/** Pure rules for customers (no I/O). */

// Crockford base32: no I, L, O, U, so a code read aloud or typed from a screen is unambiguous.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * A member code: 8 random characters (40 bits) shown as `XXXX-XXXX`. Random rather than a
 * sequence, so a code says nothing about how many members there are and can't be guessed from
 * a neighbour's.
 */
export function generateMemberCode(): string {
  const chars = [...crypto.getRandomValues(new Uint8Array(8))].map(byte => ALPHABET[byte % 32]!)
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`
}

/** A code as typed at the counter: case, spaces, dashes and look-alike letters don't matter. */
export function normalizeMemberCode(input: string): string {
  const clean = input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0')
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean
}
