/**
 * A table's QR code downloads (D91). The drawing itself is shared (`qrImage`, `qrSvg` in
 * `app/utils/qr-code.ts`, auto-imported): the counter's KHQR uses it too (D130).
 */

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
