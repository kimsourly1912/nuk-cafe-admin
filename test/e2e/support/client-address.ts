import type { Page } from 'playwright-core'

/**
 * Better Auth rate-limits sign-ins per client address (5 a minute), read from `cf-connecting-ip`
 * (D103). Every e2e request comes from one machine, so tests that sign in against the real server
 * present an address of their own, as different visitors behind Cloudflare would.
 */
export function newClientAddress(): string {
  const octet = () => Math.floor(Math.random() * 250) + 1
  return `10.${octet()}.${octet()}.${octet()}`
}

/** Headers for a `fetch` from one simulated visitor. */
export const clientHeaders = (address = newClientAddress()) => ({ 'cf-connecting-ip': address })

/** Every request this page makes comes from one new simulated visitor. */
export async function asNewVisitor(page: Page) {
  await page.setExtraHTTPHeaders(clientHeaders())
}
