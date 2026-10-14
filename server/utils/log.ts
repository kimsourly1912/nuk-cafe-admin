import type { H3Event } from 'h3'

type Level = 'debug' | 'info' | 'warn' | 'error'

/** Keys that must never reach a log line (docs/server/security.md → Logging and privacy). */
const SECRET_KEY = /pass(word)?|secret|token|cookie|authorization|session|api[-_]?key|signature/i
const MAX_STRING = 4000
const MAX_ENTRIES = 50
const MAX_DEPTH = 6

const safePath = (path: string) => path.split(/[?#]/)[0]!
  .replace(/\/(tables?|reset-password|verify-email)\/[^/]+/g, '/$1/[redacted]')

/** Query strings, URL credentials and common credential assignments never belong in diagnostics. */
function safeText(text: string): string {
  return text.slice(0, MAX_STRING)
    .replace(/https?:\/\/[^\s"'<>]+/gi, (value) => {
      try {
        const url = new URL(value)
        url.username = ''
        url.password = ''
        url.search = ''
        url.hash = ''
        url.pathname = safePath(url.pathname)
        if (url.hostname === 'api.telegram.org') url.pathname = url.pathname.replace(/^\/bot[^/]+/, '/bot[redacted]')
        return url.toString()
      }
      catch { return '[redacted URL]' }
    })
    .replace(/\/[^\s"'<>]*[?#][^\s"'<>]*/g, safePath)
    .replace(/\/(tables?|reset-password|verify-email)\/[^\s/"'<>?#]+/g, '/$1/[redacted]')
    .replace(/\b(Bearer|Basic)\s+[^\s,"';}]+/gi, '$1 [redacted]')
    .replace(/\b(password|secret|[\w-]*token|api[-_]?key|authorization|cookie|session|signature)["']?\s*[:=]\s*["']?[^\s,;"'}]+/gi, '$1=[redacted]')
}

function redact(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (typeof value === 'string') return safeText(value)
  if (typeof value === 'bigint') return String(value)
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return '[circular]'
  if (depth >= MAX_DEPTH) return '[truncated]'
  seen.add(value)
  if (value instanceof Error) {
    return redact({ name: value.name, message: value.message, stack: value.stack, cause: value.cause }, seen, depth + 1)
  }
  if (Array.isArray(value)) return value.slice(0, MAX_ENTRIES).map(item => redact(item, seen, depth + 1))
  return Object.fromEntries(Object.entries(value).slice(0, MAX_ENTRIES).map(([key, item]) => [
    safeText(key), SECRET_KEY.test(key) ? '[redacted]' : redact(item, seen, depth + 1),
  ]))
}

/**
 * One structured log line (JSON), with the request id, method and path when there is an event.
 * Workers Logs index these fields. Never pass request bodies, passwords, tokens or cookies.
 */
export function log(level: Level, message: string, fields: Record<string, unknown> = {}, event?: H3Event) {
  const line = {
    ...redact(fields) as Record<string, unknown>,
    level,
    message: safeText(message),
    ...(event ? { requestId: redact(event.context.requestId), method: event.method, path: safeText(safePath(event.path)) } : {}),
  }
  const write = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  write(JSON.stringify(line))
}
