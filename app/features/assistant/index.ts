import { defineAsyncComponent } from 'vue'

// Public API of the AI assistant (phase 9, D107, D109): the admin shell renders the panel and the
// Ask button. Only this feature talks to /api/admin/assistant.

/**
 * The panel, in its own chunk with the AI SDK it uses (`ai`, `@ai-sdk/vue`, zod: about 58 kB gzip,
 * D254): the shell mounts it once the assistant is first opened (`useAssistant().opened`), so no
 * admin page needs that code before it renders.
 */
export const AssistantPanel = defineAsyncComponent(() => import('./components/AssistantPanel.vue'))
export { useAssistant } from './composables/useAssistant'
