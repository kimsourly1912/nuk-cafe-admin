/**
 * Prices are US dollars in major units (`6.22`), as the API returns them (user decision,
 * docs/plans/products.md P1).
 */
export const CURRENCY = 'USD'

/** `Intl.NumberFormat` options, shared by the display and `UInputNumber`. */
export const PRICE_FORMAT: Intl.NumberFormatOptions = { style: 'currency', currency: CURRENCY, minimumFractionDigits: 2, maximumFractionDigits: 2 }

const formatter = new Intl.NumberFormat('en-US', PRICE_FORMAT)

/** `6.2` → `"$6.20"`; no price → `"—"`. */
export function formatPrice(price: number | undefined | null): string {
  return price === undefined || price === null || Number.isNaN(price) ? '—' : formatter.format(price)
}

/** Rounds to cents, so floating-point noise (`0.1 + 0.2`) never reaches the API. */
export function roundPrice(price: number): number {
  return Math.round(price * 100) / 100
}
