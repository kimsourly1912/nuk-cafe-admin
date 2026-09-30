import type { AssistantStatus } from '#shared/contracts/assistant'

/**
 * The assistant in the admin shell (step 9.1, D109): whether it exists here (its status route
 * answers 404 without an AI key, so the Ask button stays hidden) and whether its panel is open.
 */
export function useAssistant() {
  const status = useApiQuery('assistant:status', () => apiFetch<AssistantStatus>('/admin/assistant'))
  const enabled = computed(() => Boolean(status.data.value))
  const open = useState('assistant-panel:open', () => false)

  function toggle() {
    if (enabled.value) open.value = !open.value
  }

  return { status, enabled, open, toggle }
}
