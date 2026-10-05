import type { AssistantImportStatus } from '#shared/contracts/assistant-import'

/** Independent of help-chat settings; the import entry is hidden until the server switch is on. */
export function useAssistantImportStatus() {
  return useApiQuery('assistant-import:status', () => apiFetch<AssistantImportStatus>('/admin/assistant/import-status'))
}
