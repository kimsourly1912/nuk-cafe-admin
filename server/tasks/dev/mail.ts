import { MAIL_KINDS } from '#server/features/identity'
import { recentOutboxMessages } from '#server/features/platform'

/**
 * The newest account emails (password reset, email confirmation) with their links, to follow them
 * without a mail account (D209). Dev server only: `pnpm dev:mail`. The links are secrets, which is
 * why only the dev server lists them.
 */
export default defineTask({
  meta: { name: 'dev:mail', description: 'List the newest account emails and their links' },
  async run() {
    if (!import.meta.dev) throw new Error('Account emails are listed on the dev server only.')
    const rows = await recentOutboxMessages(useDb(), Object.values(MAIL_KINDS), 10)
    return { result: rows.map(row => ({ kind: row.kind, to: row.payload.to, url: row.payload.url, status: row.status, createdAt: row.createdAt.toISOString() })) }
  },
})
