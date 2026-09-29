import { encode } from 'uqr'

/**
 * A table's QR code drawn from its link (D91): one SVG path of dark modules on a light square,
 * with a quiet zone around it. Always dark on light, in both themes: scanners need that contrast,
 * so the colors are part of the image, not of the UI theme.
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

/** A file name from the table's label: "Table 01" → "table-01-qr". */
export const qrFileName = (label: string) => `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'table'}-qr`

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export function downloadQrSvg(value: string, label: string) {
  download(new Blob([qrSvg(value)], { type: 'image/svg+xml' }), `${qrFileName(label)}.svg`)
}

/** A 1024 px PNG, drawn from the SVG. */
export async function downloadQrPng(value: string, label: string) {
  const url = URL.createObjectURL(new Blob([qrSvg(value)], { type: 'image/svg+xml' }))
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1024
    const context = canvas.getContext('2d')!
    context.imageSmoothingEnabled = false
    context.drawImage(image, 0, 0, 1024, 1024)
    const png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    if (png) download(png, `${qrFileName(label)}.png`)
  }
  finally {
    URL.revokeObjectURL(url)
  }
}
