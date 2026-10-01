import { assistantStatus } from '#server/features/assistant'

/**
 * `GET /api/admin/assistant` (step 9.1, D109): whether the assistant is on here (404 when no AI key
 * is set, like its other routes) and today's use, so the admin app shows the Ask button only where
 * it works.
 */
export default defineEventHandler(async (event) => {
  const { actor, settings } = await requireAssistant(event)
  return assistantStatus(useDb(), actor, settings)
})
