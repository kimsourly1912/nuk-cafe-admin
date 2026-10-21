/**
 * The API stores prices as integer cents of USD (`priceMinor`); forms and the display work in
 * dollars. Convert only at the boundary: `toMinor` when sending, `fromMinor` when reading.
 * Shared by every screen that shows prices (menu items, add-ons).
 */

/** The only currency at launch (D45). */
export const CURRENCY = 'USD'

/** `Intl.NumberFormat` options, shared by the display and `UInputNumber`. */
export const PRICE_FORMAT: Intl.NumberFormatOptions = { style: 'currency', currency: CURRENCY, minimumFractionDigits: 2, maximumFractionDigits: 2 }

const formatter = new Intl.NumberFormat('en-US', PRICE_FORMAT)

/** `6.2` → `"$6.20"`; no price → `"—"`. Dollars. */
export function formatPrice(price: number | undefined | null): string {
  return price === undefined || price === null || Number.isNaN(price) ? '—' : formatter.format(price)
}

/** Cents → `"$6.20"`. */
export function formatMinor(priceMinor: number | undefined | null): string {
  return priceMinor === undefined || priceMinor === null ? '—' : formatPrice(fromMinor(priceMinor))
}

/**
 * Dollars → whole cents, half up. Shifts the decimal point in the number's text: `1.005 * 100`
 * is `100.4999…` and would round down; floating-point noise (`0.1 + 0.2`) never reaches the API.
 */
export function toMinor(price: number): number {
  const shifted = Number(`${price}e2`)
  // Numbers JS writes in exponent form (1e-7) can't be shifted in text; they're far below a cent.
  return Math.round(Number.isNaN(shifted) ? price * 100 : shifted)
}

export const fromMinor = (priceMinor: number) => priceMinor / 100

/** Rounds dollars to cents. */
export const roundPrice = (price: number) => fromMinor(toMinor(price))
