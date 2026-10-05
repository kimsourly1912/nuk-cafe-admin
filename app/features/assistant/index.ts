// Public API of the AI assistant (phase 9, D107, D109): the admin shell renders the panel and the
// Help panel and conditional menu-import entry. Only this feature talks to /api/admin/assistant.
export { default as AssistantPanel } from './components/AssistantPanel.vue'
export { useAssistant } from './composables/useAssistant'
export { default as AssistantImportButton } from './components/AssistantImportButton.vue'
