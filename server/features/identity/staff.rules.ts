/** Pure rules for staff management (no I/O). */

// No 0/O, 1/l/I: the password is read off a screen and typed in by hand.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'

/**
 * A temporary password: 4 groups of 4 characters (about 91 bits), e.g. `Hq7x-3mPa-kR9t-Wz2c`.
 * Random from the platform's CSPRNG, without modulo bias.
 */
export function generateTemporaryPassword(): string {
  const chars: string[] = []
  const limit = 256 - (256 % ALPHABET.length)
  while (chars.length < 16) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      if (byte < limit && chars.length < 16) chars.push(ALPHABET[byte % ALPHABET.length]!)
    }
  }
  return [0, 4, 8, 12].map(i => chars.slice(i, i + 4).join('')).join('-')
}

/**
 * The next version of an account: `updated_at` in milliseconds, strictly increasing even when two
 * writes land in the same millisecond, so a stale version never matches again.
 */
export function nextVersion(current: Date, now = new Date()): Date {
  return new Date(Math.max(now.getTime(), current.getTime() + 1))
}

/** `user.role` may hold several comma-separated roles (Better Auth); ours only ever set one. */
export function isPlatformAdmin(role: string | null | undefined): boolean {
  return (role ?? '').split(',').map(r => r.trim()).includes('admin')
}
