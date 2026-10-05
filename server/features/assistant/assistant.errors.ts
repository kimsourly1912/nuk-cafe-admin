import { apiError, notFound } from '#server/utils/errors'

/** Error codes of the AI assistant (phase 9, D107, D108). */
export const AssistantErrorCodes = {
  /** Enabled but settings or the binding are incomplete: a deployment mistake. */
  AI_NOT_CONFIGURED: 'AI_NOT_CONFIGURED',
  /** The admin used today's requests. */
  AI_LIMIT_REACHED: 'AI_LIMIT_REACHED',
  /** The provider failed, timed out or refused the key. */
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
} as const

/** No key in this environment: the assistant doesn't exist here. */
export const assistantOff = () => notFound('This page')

export const aiNotConfigured = (problem: string) =>
  apiError(500, AssistantErrorCodes.AI_NOT_CONFIGURED, `The assistant's settings are incomplete: ${problem}`)

export const aiLimitReached = (limit: number) =>
  apiError(429, AssistantErrorCodes.AI_LIMIT_REACHED, `You've used today's ${limit} assistant requests. They reset at midnight.`)

/** Shown to the admin when the provider fails; the cause goes to the log, never to the screen. */
export const AI_UNAVAILABLE_MESSAGE = 'The assistant can\'t answer right now. Try again in a moment.'

/** Capacity/quota is separate from the app's per-owner counter; never expose provider bodies. */
export function providerFailureMessage(provider: string, error: unknown): string {
  const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined
  return provider === 'cloudflare' && status === 429
    ? 'Cloudflare AI capacity or its daily allocation has been reached. Try again later. The daily allocation resets at 00:00 UTC.'
    : AI_UNAVAILABLE_MESSAGE
}

export const aiUnavailable = () => apiError(503, AssistantErrorCodes.AI_UNAVAILABLE, AI_UNAVAILABLE_MESSAGE)
