import type { ReportMessagePreview } from '#shared/contracts/notifications'
import { reportMessageSchema } from '#shared/contracts/notifications'
import { reportMessage } from '~~/server/features/orders'

/**
 * `{ kind, query }`: the message Send to Telegram would send for this report and query, as plain
 * text (step 8.1c, D112). A read, as a POST because the page's query travels in the body.
 */
export default defineEventHandler(async (event): Promise<ReportMessagePreview> => {
  requireTelegram(event)
  await requirePermission(event, { report: ['export'] })
  const { text } = await reportMessage(useDb(), await readValidBody(event, reportMessageSchema), { attachCsv: false })
  return { text }
})
