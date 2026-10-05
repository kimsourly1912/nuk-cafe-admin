import type { AssistantImportDraft, AssistantImportReview, AssistantImportSource, DiscardAssistantImportResult } from '#shared/contracts/assistant-import'
import { importDraftCommands, importFileProblem, IMPORT_BASE } from '../utils/import'
import type { ImportCreateRequest } from '../utils/import'
import { useAssistantImportStatus } from './useAssistantImportStatus'

/** One private source at a time; all writes use the standard mutation engine and source lock. */
export function useAssistantImport() {
  const route = useRoute()
  const status = useAssistantImportStatus()
  const sourceId = computed(() => typeof route.query.source === 'string' ? route.query.source : '')
  const enabled = computed(() => status.data.value?.enabled === true)
  const sources = useApiQuery('assistant-import:sources', () => apiFetch<AssistantImportSource[]>(IMPORT_BASE), { enabled, watch: [enabled] })
  const reviewQuery = useApiQuery(() => `assistant-import:review:${sourceId.value || 'none'}`, () => apiFetch<AssistantImportReview>(`${IMPORT_BASE}/${encodeURIComponent(sourceId.value)}/review`), { enabled: () => enabled.value && Boolean(sourceId.value), watch: [enabled] })
  const review = computed(() => reviewQuery.data.value?.source.id === sourceId.value ? reviewQuery.data.value : undefined)
  let live = true
  let extraction: AbortController | undefined
  const active = (id: string) => live && sourceId.value === id
  const accept = (next: AssistantImportReview) => {
    if (active(next.source.id)) reviewQuery.data.value = next
  }
  const lock = (input: { sourceId: string }) => `assistant-import:${input.sourceId}`
  const now = ref(Date.now())
  let clock: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    clock = setInterval(() => {
      now.value = Date.now()
      if (review.value?.state === 'processing' && !reviewQuery.pending.value) void reviewQuery.refresh()
    }, 2000)
  })
  const expired = computed(() => Boolean(review.value && Date.parse(review.value.source.expiresAt) <= now.value))
  const leaseBusy = computed(() => Boolean(review.value?.retryAt && Date.parse(review.value.retryAt) > now.value))
  const upload = useMutation(async (file: File) => {
    const problem = importFileProblem(file)
    if (problem) throw new ApiError(problem, { kind: 'validation', status: 400 })
    return apiFetch<AssistantImportSource>(IMPORT_BASE, { method: 'POST', body: file, headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) } })
  }, { id: 'assistant-import:upload', successMessage: 'Source uploaded', errorMessage: 'Could not upload source', invalidate: ['assistant-import'] })
  const update = useMutation(async (input: { sourceId: string, rowId: string, version: number, draft?: AssistantImportDraft, selected?: boolean }) => {
    const { sourceId: id, rowId, ...body } = input
    const next = await apiFetch<AssistantImportReview>(`${IMPORT_BASE}/${id}/review/${rowId}`, { method: 'PATCH', body })
    accept(next)
    create.reset(`${id}:${rowId}`)
    return next
  }, { id: 'assistant-import:update', key: i => `${i.sourceId}:${i.rowId}`, lock, successMessage: false, errorMessage: 'Could not apply correction' })
  const extract = useMutation(async (input: { sourceId: string }) => {
    const latest = await apiFetch<AssistantImportReview>(`${IMPORT_BASE}/${input.sourceId}/review`)
    if (!active(input.sourceId)) throw new ApiError('The request was cancelled.', { kind: 'aborted', status: 0 })
    accept(latest)
    extraction = new AbortController()
    try {
      const next = await apiFetch<AssistantImportReview>(`${IMPORT_BASE}/${input.sourceId}/extract`, { method: 'POST', body: { version: latest.source.version }, timeout: 70_000, signal: extraction.signal })
      accept(next)
      return next
    }
    finally {
      extraction = undefined
      if (active(input.sourceId)) void reviewQuery.refresh()
    }
  }, { id: 'assistant-import:extract', key: i => i.sourceId, lock, successMessage: 'Menu ready for review', errorMessage: 'Could not extract menu' })
  // Cancellation intentionally runs while extraction holds the source lock.
  const cancel = useMutation(async (input: { sourceId: string }) => {
    const latest = await apiFetch<AssistantImportReview>(`${IMPORT_BASE}/${input.sourceId}/review`)
    const next = await apiFetch<AssistantImportReview>(`${IMPORT_BASE}/${input.sourceId}/cancel`, { method: 'POST', body: { version: latest.source.version } })
    extraction?.abort()
    accept(next)
    return next
  }, { id: 'assistant-import:cancel', key: i => i.sourceId, successMessage: 'Extraction stopped', errorMessage: 'Could not stop extraction' })
  const create = useMutation(importDraftCommands(apiFetch, accept, active), {
    id: 'assistant-import:create', key: (i: ImportCreateRequest) => `${i.sourceId}:${i.rowId}`, lock,
    successMessage: 'Menu draft created', errorMessage: 'Could not create draft', invalidate: ['products'],
    batch: { noun: ['draft', 'drafts'], verb: ['Creating', 'created'], concurrency: 1, confirm: inputs => ({ title: `Create ${inputs.length} ${inputs.length === 1 ? 'draft' : 'drafts'}?`, description: 'Each item is saved separately. You can review and publish them through Menu items.', confirmLabel: 'Create drafts' }) },
  })
  const discard = useMutation(async (input: { sourceId: string }) => {
    const latest = await apiFetch<AssistantImportReview>(`${IMPORT_BASE}/${input.sourceId}/review`)
    return apiFetch<DiscardAssistantImportResult>(`${IMPORT_BASE}/${input.sourceId}/discard`, { method: 'POST', body: { version: latest.source.version } })
  }, { id: 'assistant-import:discard', key: i => i.sourceId, lock, successMessage: 'Private source discarded', errorMessage: 'Could not discard source', invalidate: ['assistant-import'], confirm: { title: 'Discard this import?', description: 'The private source and review will be deleted. Menu drafts already created will stay in Menu items.', confirmLabel: 'Discard import', danger: true } })
  const batchBusy = ref(false)
  const busy = computed(() => batchBusy.value || upload.pending || update.pending || extract.pending || cancel.pending || create.pending || discard.pending)
  const nuxtApp = useNuxtApp()
  const unhook = nuxtApp.hook('app:session-changed', () => {
    live = false
    extraction?.abort()
  })
  onScopeDispose(() => {
    live = false
    extraction?.abort()
    clearInterval(clock)
    unhook()
  })
  return { status, enabled, sourceId, sources, reviewQuery, review, expired, leaseBusy, upload, update, extract, cancel, create, discard, batchBusy, busy }
}
