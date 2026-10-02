import { encode } from 'uqr'

/**
 * A QR code drawn as SVG (a table's link, D91; an order's KHQR at the counter, D130): one SVG path
 * of dark modules on a light square, with a quiet zone around it. Always dark on light, in both
 * themes: scanners need that contrast, so the colors are part of the image, not of the UI theme.
 */

const QUIET_ZONE = 2

export interface QrImage {
  /** Width and height in modules, quiet zone included. */
  size: number
  /** The dark modules, one square each. */
  path: string
}

export function qrImage(value: string): QrImage {
  const { data, size } = encode(value, { ecc: 'M', border: QUIET_ZONE })
  const path = data.flatMap((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : ''))).join('')
  return { size, path }
}

/** The QR as a standalone SVG file (black on white), for printing at any size. */
export function qrSvg(value: string): string {
  const { size, path } = qrImage(value)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`
}
