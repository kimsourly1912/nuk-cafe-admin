import type { H3Event } from 'h3'

type Level = 'debug' | 'info' | 'warn' | 'error'

/** Keys that must never reach a log line (docs/server/security.md → Logging and privacy). */
const SECRET_KEY = /pass(word)?|secret|token|cookie|authorization|session/i

function redact(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, SECRET_KEY.test(key) ? '[redacted]' : value]))
}

/**
 * One structured log line (JSON), with the request id, method and path when there is an event.
 * Workers Logs index these fields. Never pass request bodies, passwords, tokens or cookies.
 */
export function log(level: Level, message: string, fields: Record<string, unknown> = {}, event?: H3Event) {
  const line = {
    level,
    message,
    ...(event ? { requestId: event.context.requestId, method: event.method, path: event.path } : {}),
    ...redact(fields),
  }
  const write = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  write(JSON.stringify(line))
}
