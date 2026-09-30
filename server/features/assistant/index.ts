// Public API of the assistant feature (phase 9, D107). Other code imports only from here; no other
// feature imports the assistant or any AI package.
export { AI_UNAVAILABLE_MESSAGE, AssistantErrorCodes, assistantOff } from './assistant.errors'
export { languageModel } from './assistant.model'
export { assistantSettingsFrom } from './assistant.settings'
export type { AssistantSettings } from './assistant.settings'
export { finishUsage, pingAssistant, purgeAssistantUsage, startUsage, usageResult } from './assistant.service'
