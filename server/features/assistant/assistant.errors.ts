import { apiError, notFound } from '../../utils/errors'

/** Error codes of the AI assistant (phase 9, D107, D108). */
export const AssistantErrorCodes = {
  /** A key is set but the other settings are incomplete or unknown: a deployment mistake. */
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

export const aiUnavailable = () => apiError(503, AssistantErrorCodes.AI_UNAVAILABLE, AI_UNAVAILABLE_MESSAGE)
