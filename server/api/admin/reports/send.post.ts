import { sendReportSchema } from '#shared/contracts/notifications'
import { sendReport } from '#server/features/notifications'
import { reportMessage } from '#server/features/orders'

/**
 * `{ report: { kind, query }, destinationId, attachCsv }` with an `Idempotency-Key`: sends the
 * report to a connected chat (step 8.1c, D112). The server builds the message, never the page.
 */
export default defineEventHandler(async (event) => {
  const { api } = requireTelegram(event)
  const actor = await requirePermission(event, { report: ['export'] })
  const key = readIdempotencyKey(event)
  const input = await readValidBody(event, sendReportSchema)
  const db = useDb()
  return sendReport(db, api, actor, key, input, async () => {
    const message = await reportMessage(db, input.report, { attachCsv: input.attachCsv })
    return {
      subject: message.subject,
      html: message.html,
      document: message.csv ? { filename: message.csv.filename, content: message.csv.csv } : undefined,
      audit: message.audit,
    }
  })
})
