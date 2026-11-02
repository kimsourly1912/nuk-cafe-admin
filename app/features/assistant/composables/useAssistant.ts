import type { AssistantStatus } from '#shared/contracts/assistant'

/**
 * The assistant in the admin shell (step 9.1, D109): whether it exists here (its status route
 * answers 404 without an AI key, so the Ask button stays hidden), whether its panel is open, and
 * whether it has been opened in this tab: the shell mounts the panel, and loads its chat code (the AI
 * SDK), only from then on (D254).
 */
export function useAssistant() {
  const status = useApiQuery('assistant:status', () => apiFetch<AssistantStatus>('/admin/assistant'))
  const enabled = computed(() => Boolean(status.data.value))
  const open = useState('assistant-panel:open', () => false)
  const opened = useState('assistant-panel:opened', () => false)

  function toggle() {
    if (!enabled.value) return
    open.value = !open.value
    if (open.value) opened.value = true
  }

  return { status, enabled, open, opened, toggle }
}
