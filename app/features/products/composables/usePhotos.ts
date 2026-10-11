import type { PhotoForEdit, UploadedPhoto } from '#shared/contracts/media'

/** Uploads get longer than the API's 30 s default: a photo and three files on a slow connection. */
const UPLOAD_TIMEOUT_MS = 120_000

/**
 * The photo editor's uploads (`POST /api/admin/media/photos`, D158), keyed by the editor that
 * started it. Nothing is saved until the menu item is; an unused photo is deleted after 24 hours.
 */
export function usePhotoUpload() {
  return useMutation(
    ({ body }: { body: FormData, editor: string }) => apiFetch<UploadedPhoto>('/admin/media/photos', { method: 'POST', body, timeout: UPLOAD_TIMEOUT_MS }),
    {
      id: 'media:photo-upload',
      key: ({ editor }) => editor,
      successMessage: false,
      errorMessage: 'Could not upload the photo',
    },
  )
}

/** A photo to edit again: how it was made (`null` before D158) and its files. */
export const fetchPhotoForEdit = (id: string) => apiFetch<PhotoForEdit>(`/admin/media/photos/${encodeURIComponent(id)}`)

/**
 * The photo itself to edit: its private source, or for a photo from before D158 its one public
 * file (same origin, so the editor can draw it).
 */
export async function fetchPhotoFile(photo: PhotoForEdit): Promise<Blob> {
  if (photo.edit) {
    return apiFetch<Blob>(`/admin/media/photos/${encodeURIComponent(photo.id)}/source`, { responseType: 'blob' } as unknown as Parameters<typeof apiFetch>[1])
  }
  const response = await fetch(photo.image.card)
  if (!response.ok) throw new Error('The photo couldn\'t be loaded.')
  return response.blob()
}
