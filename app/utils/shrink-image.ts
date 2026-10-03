/**
 * Photos are made smaller in the admin's browser before upload (D122): a phone photo of several MB
 * becomes a WebP of at most 1600 px on its longest side, usually 100–300 KB, so the customer menu
 * loads fast on mobile data. Nothing is enlarged, and a file that's already smaller is kept as is.
 * If the browser can't decode or encode the image, the original is uploaded and the server's checks
 * (type, 5 MB) still apply.
 */
export const IMAGE_MAX_EDGE = 1600
export const IMAGE_QUALITY = 0.82
/** Larger originals aren't decoded at all (a phone's memory); the server limit is on the result. */
export const IMAGE_MAX_ORIGINAL_BYTES = 25 * 1024 * 1024

/** The size to draw at: the longest side at most `maxEdge`, the proportions kept, never enlarged. */
export function fitWithin(width: number, height: number, maxEdge = IMAGE_MAX_EDGE): { width: number, height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** The smaller image when it's really smaller; otherwise the original. */
export function pickSmaller(original: File, shrunk: Blob | null): File {
  if (!shrunk || shrunk.size >= original.size) return original
  const extension = shrunk.type === 'image/webp' ? 'webp' : shrunk.type === 'image/png' ? 'png' : 'jpg'
  const base = original.name.replace(/\.[^.]+$/, '') || 'photo'
  return new File([shrunk], `${base}.${extension}`, { type: shrunk.type })
}

async function encode(canvas: HTMLCanvasElement): Promise<Blob | null> {
  const webp = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', IMAGE_QUALITY))
  // A browser that can't write WebP gives PNG instead: JPEG is smaller for photos.
  if (webp?.type === 'image/webp') return webp
  return new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', IMAGE_QUALITY))
}

/** The file to upload: `file` made smaller when possible, else `file` itself. */
export async function shrinkImage(file: File): Promise<File> {
  try {
    // `from-image` turns a phone photo the right way up (its EXIF orientation).
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const { width, height } = fitWithin(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return file
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    return pickSmaller(file, await encode(canvas))
  }
  catch {
    return file
  }
}
