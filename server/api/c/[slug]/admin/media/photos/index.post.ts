import * as v from 'valibot'
import { photoEditSchema, PHOTO_UPLOAD_MAX_BYTES } from '#shared/contracts/media'
import { uploadPhoto } from '#server/features/media'

/**
 * A menu photo from the photo editor (D158), multipart: `source` (the photo the right way up, at
 * most 2400 px), `card` (480 × 480), `detail` (1200 × 900), `detailSmall` (600 × 450), `edit` (JSON:
 * how they were made) and `placeholder` (a tiny data URL). 201 with the photo's id and files; it
 * stays temporary until a menu item uses it.
 */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { media: ['upload'] })
  const parts = await readLimitedMultipart(event, PHOTO_UPLOAD_MAX_BYTES)
  const file = (name: string) => {
    const part = parts.find(p => p.name === name && p.filename)
    return part && { type: part.type ?? '', data: new Uint8Array(part.data) }
  }
  const text = (name: string) => {
    const part = parts.find(p => p.name === name && !p.filename)
    return part ? new TextDecoder().decode(part.data) : undefined
  }
  let edit: unknown
  try {
    edit = JSON.parse(text('edit') ?? 'null')
  }
  catch {
    edit = null
  }
  const parsed = v.safeParse(photoEditSchema, edit)
  if (!parsed.success) throw apiError(400, 'VALIDATION_FAILED', 'This photo couldn\'t be saved. Try again, or choose another photo.', { fieldErrors: { edit: ['Invalid'] } })
  const photo = await uploadPhoto(useDb(), blob, actor, {
    source: file('source'),
    card: file('card'),
    detail: file('detail'),
    detailSmall: file('detailSmall'),
    edit: parsed.output,
    placeholder: text('placeholder'),
  })
  setResponseStatus(event, 201)
  return photo
})
