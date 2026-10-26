import type { OutboxHandler } from '#server/features/platform'

/**
 * Account emails (docs/server/operations.md → Email, D51): verification and password reset.
 * Better Auth's callbacks only queue an outbox message; `platform:deliver-outbox` renders and sends
 * it, retrying on failure. Plain, short, one link, no tracking; English only (Q21).
 */

export const MAIL_KINDS = {
  verifyEmail: 'identity.verify-email',
  resetPassword: 'identity.reset-password',
} as const

export interface MailMessage {
  to: string
  subject: string
  text: string
  html: string
}

/**
 * Sends one email. Delivery is at least once (the outbox retries): Cloudflare Email Sending takes no
 * idempotency key, so a send whose answer was lost can arrive twice, with the same link (D212).
 */
export type MailSender = (message: MailMessage) => Promise<void>

const APP = 'NUK Cafe'

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]!)

function render(to: string, subject: string, intro: string, action: string, url: string, outro: string): MailMessage {
  return {
    to,
    subject,
    text: `${intro}\n\n${action}: ${url}\n\n${outro}\n\n${APP}`,
    html: `<p>${escapeHtml(intro)}</p><p><a href="${escapeHtml(url)}">${escapeHtml(action)}</a></p><p>${escapeHtml(outro)}</p><p>${APP}</p>`,
  }
}

export function verificationMail(to: string, url: string): MailMessage {
  return render(to, `Confirm your email for ${APP}`, `Confirm that ${to} is your email address to start ordering.`, 'Confirm my email', url, 'If you didn\'t sign up, you can ignore this email.')
}

export function resetPasswordMail(to: string, url: string): MailMessage {
  return render(to, `Reset your ${APP} password`, 'Someone asked to reset the password of this account. The link works once and expires in 1 hour.', 'Choose a new password', url, 'If it wasn\'t you, ignore this email: your password stays the same.')
}

interface LinkPayload {
  to: string
  url: string
}

function linkPayload(payload: Record<string, unknown>): LinkPayload {
  if (typeof payload.to !== 'string' || typeof payload.url !== 'string') throw new Error('Mail payload needs "to" and "url"')
  return { to: payload.to, url: payload.url }
}

/** The outbox handlers for account emails, for the delivery task's registry. */
export function accountMailHandlers(send: MailSender): Record<string, OutboxHandler> {
  return {
    [MAIL_KINDS.verifyEmail]: async ({ payload }) => {
      const { to, url } = linkPayload(payload)
      await send(verificationMail(to, url))
    },
    [MAIL_KINDS.resetPassword]: async ({ payload }) => {
      const { to, url } = linkPayload(payload)
      await send(resetPasswordMail(to, url))
    },
  }
}

/** Cloudflare's `send_email` binding (Email Sending), as much of it as we use. */
export interface EmailBinding {
  send: (message: {
    to: string
    from: string | { email: string, name: string }
    subject: string
    text: string
    html: string
  }) => Promise<{ messageId: string }>
}

/**
 * Cloudflare Email Sending through the Worker's `EMAIL` binding (D212). A refusal throws, so the
 * outbox retries; the error names only Cloudflare's code (e.g. `E_RATE_LIMIT_EXCEEDED`), never the
 * address, since its message can carry it.
 */
export function cloudflareEmailSender(options: { binding: EmailBinding, from: string, fromName: string, timeoutMs?: number }): MailSender {
  const { binding, from, fromName, timeoutMs = 10_000 } = options
  return async (message) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    // The binding takes no abort signal: the deadline keeps one stuck send from holding the
    // outbox run (docs/reference/server-reliability.md). A late success can still arrive.
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('timed out'), { code: 'TIMEOUT' })), timeoutMs)
    })
    try {
      await Promise.race([
        binding.send({
          to: message.to,
          from: fromName ? { email: from, name: fromName } : from,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        deadline,
      ])
    }
    catch (error) {
      const code = (error as { code?: unknown } | null)?.code
      // No `cause`: the log prints it, and Cloudflare's message can carry the recipient's address.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(`Email Sending refused the message: ${typeof code === 'string' ? code : 'unknown error'}`)
    }
    finally {
      clearTimeout(timer)
    }
  }
}

/** Local development: prints the email (with its link) instead of sending it. Never in production. */
export function consoleSender(print: (text: string) => void = console.info): MailSender {
  return async (message) => {
    print(`[mail] To: ${message.to}\n[mail] Subject: ${message.subject}\n${message.text}`)
  }
}
