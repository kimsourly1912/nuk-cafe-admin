import type { OutboxHandler } from '../platform'

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
 * Sends one email. `idempotencyKey` is the outbox message id: a repeat delivery (at least once)
 * must not send twice.
 */
export type MailSender = (message: MailMessage, idempotencyKey: string) => Promise<void>

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
    [MAIL_KINDS.verifyEmail]: async ({ id, payload }) => {
      const { to, url } = linkPayload(payload)
      await send(verificationMail(to, url), id)
    },
    [MAIL_KINDS.resetPassword]: async ({ id, payload }) => {
      const { to, url } = linkPayload(payload)
      await send(resetPasswordMail(to, url), id)
    },
  }
}

/** Resend's HTTP API. A non-2xx answer throws, so the outbox retries. */
export function resendSender(options: { apiKey: string, from: string, fetch?: typeof fetch }): MailSender {
  const doFetch = options.fetch ?? fetch
  return async (message, idempotencyKey) => {
    const response = await doFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
        // Resend keeps it 24 h: a repeated delivery of this message isn't sent again.
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ from: options.from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Resend answered ${response.status}: ${detail.slice(0, 200)}`)
    }
  }
}

/** Local development: prints the email (with its link) instead of sending it. Never in production. */
export function consoleSender(print: (text: string) => void = console.info): MailSender {
  return async (message) => {
    print(`[mail] To: ${message.to}\n[mail] Subject: ${message.subject}\n${message.text}`)
  }
}
