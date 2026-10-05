import type { AssistantImportSource } from '#shared/contracts/assistant-import'
import { checkPdfBytes, PDF_PREPARATION_TIMEOUT_MS, PdfPreparationError, pdfErrorMessage, pdfSelection } from '../utils/pdf'
import { IMPORT_BASE } from '../utils/import'
import type { openImportPdf } from '../utils/pdf-document.client'

/** The query stores page count only. Source bytes and the PDF worker are owned by this scope. */
export function useAssistantPdf(source: AssistantImportSource) {
  const route = useRoute()
  const router = useRouter()
  let live = true
  let controller: AbortController | undefined
  let document: Awaited<ReturnType<typeof openImportPdf>> | undefined
  let previewController: AbortController | undefined
  const preview = shallowRef<HTMLCanvasElement>()
  const page = ref(1)
  const previewBusy = ref(false)
  const previewError = ref<string>()
  const clearPreview = () => {
    previewController?.abort()
    previewController = undefined
    if (preview.value) {
      preview.value.width = 0
      preview.value.height = 0
    }
    preview.value = undefined
    previewError.value = undefined
    previewBusy.value = false
  }
  const dispose = () => {
    controller?.abort()
    controller = undefined
    document?.dispose()
    document = undefined
    clearPreview()
  }
  const query = useApiQuery(`assistant-import:pdf:${source.id}`, async () => {
    if (!live) throw new ApiError('The preview was cancelled.', { kind: 'aborted', status: 0 })
    dispose()
    const current = new AbortController()
    controller = current
    const signal = current.signal
    const timeout = setTimeout(() => current.abort(), PDF_PREPARATION_TIMEOUT_MS)
    try {
      // ofetch detects application/pdf as a Blob. The standard client keeps session/error handling.
      const blob = await apiFetch<Blob>(`${IMPORT_BASE}/${source.id}/source`, { signal })
      if (!live) signal.throwIfAborted()
      checkPdfBytes(blob.size)
      const next = import.meta.client
        ? await (await import('../utils/pdf-document.client')).openImportPdf(new Uint8Array(await blob.arrayBuffer()), signal)
        : undefined
      if (!next) throw new Error('PDF preparation requires a browser.')
      if (!live || controller !== current || signal.aborted) {
        next.dispose()
        throw new ApiError('The preview was cancelled.', { kind: 'aborted', status: 0 })
      }
      document = next
      page.value = pdfSelection(route.query.pages, next.totalPages)[0] ?? 1
      return { totalPages: next.totalPages }
    }
    catch (error) {
      const cancelled = signal.aborted
      if (controller === current) dispose()
      if (error instanceof ApiError) throw error
      if (cancelled) throw new ApiError(live ? 'PDF preview took too long. Try a smaller copy or a menu image.' : 'The preview was cancelled.', { kind: live ? 'timeout' : 'aborted', status: 0 })
      // Only our bounded admission helpers have safe, literal error messages.
      if (error instanceof PdfPreparationError) throw new ApiError(error.message, { kind: 'validation', status: 422 })
      throw new ApiError(pdfErrorMessage(error), { kind: 'validation', status: 422 })
    }
    finally { clearTimeout(timeout) }
  }, { server: false, immediate: false, deep: false })
  const pages = computed(() => Array.from({ length: query.data.value?.totalPages ?? 0 }, (_, i) => i + 1))
  const selected = computed(() => query.data.value ? pdfSelection(route.query.pages, query.data.value.totalPages) : [])
  async function select(number: number, value: boolean) {
    const next = selected.value.filter(n => n !== number)
    if (value) next.push(number)
    await router.replace({ query: { ...route.query, pages: next.sort((a, b) => a - b).join(',') } })
  }
  async function show(number: number) {
    if (!live || !document || previewBusy.value) return
    clearPreview()
    page.value = number
    previewBusy.value = true
    const current = new AbortController()
    previewController = current
    const canvas = window.document.createElement('canvas')
    try {
      const timeout = setTimeout(() => {
        current.abort()
        dispose()
      }, PDF_PREPARATION_TIMEOUT_MS)
      try {
        await document.render(number, canvas)
      }
      finally { clearTimeout(timeout) }
      if (!live || current.signal.aborted) return
      preview.value = canvas
    }
    catch {
      canvas.width = 0
      canvas.height = 0
      if (live && !current.signal.aborted) previewError.value = 'This page could not be previewed. Try again or upload this page as an image.'
      else if (live && current.signal.aborted) previewError.value = 'Page preview took too long. Reload the PDF or upload a smaller image.'
    }
    finally { if (previewController === current) previewBusy.value = false }
  }
  const nuxtApp = useNuxtApp()
  const unhook = nuxtApp.hook('app:session-changed', () => {
    live = false
    dispose()
    query.clear()
  })
  onScopeDispose(() => {
    live = false
    dispose()
    query.clear()
    unhook()
  })
  return { query, pages, selected, select, page, preview, previewBusy, previewError, show }
}
