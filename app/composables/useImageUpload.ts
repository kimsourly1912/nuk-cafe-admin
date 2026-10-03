import type { MediaAsset } from '#shared/contracts/media'

/** Uploads get longer than the API's 30 s default: 5 MB on a slow connection. */
const UPLOAD_TIMEOUT_MS = 120_000

/**
 * Uploads an image to the cafe's media (`POST /api/admin/media`, D57) and returns the asset (`id`
 * for the record, `url` for the preview). Keyed by the input that started it, so each open form
 * tracks its own upload. Nothing is saved until the form is; an unused upload is deleted by the
 * server after 24 hours. Used by `<ImageInput>` (a menu item's photo, the cafe's logo).
 */
export function useImageUpload() {
  return useMutation(
    ({ file }: { file: File, input: string }) => {
      const body = new FormData()
      body.append('file', file)
      return apiFetch<MediaAsset>('/admin/media', { method: 'POST', body, timeout: UPLOAD_TIMEOUT_MS })
    },
    {
      id: 'media:upload',
      key: ({ input }) => input,
      successMessage: false,
      errorMessage: ({ file }) => `Could not upload "${file.name}"`,
    },
  )
}
