import { apiError, ErrorCodes, notFound, versionConflict } from '#server/utils/errors'

export const MarketingErrorCodes = {
  CHANNEL_REMOVED: 'CHANNEL_REMOVED',
  CHANNEL_LINK_UNUSABLE: 'CHANNEL_LINK_UNUSABLE',
  PROMOTION_NOT_RUNNING: 'PROMOTION_NOT_RUNNING',
  POST_TIME_INVALID: 'POST_TIME_INVALID',
} as const

export const channelNotFound = () => notFound('This channel')
export const channelChanged = () => versionConflict('This channel')
export const channelLinkNotFound = () => notFound('This connect code')
export const postNotFound = () => notFound('This post')
export const postChanged = () => versionConflict('This post')

export const channelLinkUnusable = () =>
  apiError(409, MarketingErrorCodes.CHANNEL_LINK_UNUSABLE, 'This connect code was used or has expired. Make a new one.')

/** A chosen channel isn't connected (the bot was removed from it, or it was disconnected). */
export const channelRemoved = (title: string) =>
  apiError(409, MarketingErrorCodes.CHANNEL_REMOVED, `The bot is no longer an admin of "${title}". Reconnect the channel on Marketing → Channels.`, {
    fieldErrors: { channelIds: [`Reconnect "${title}" first`] },
  })

/** Only a scheduled or live promotion can be posted: customers would open a menu without it. */
export const promotionNotRunning = () =>
  apiError(409, MarketingErrorCodes.PROMOTION_NOT_RUNNING, 'Only a published promotion that hasn\'t ended can be posted.')

export const postTimeInvalid = (message: string) =>
  apiError(422, MarketingErrorCodes.POST_TIME_INVALID, message, { fieldErrors: { at: [message] } })

export const postNotPending = () => apiError(409, ErrorCodes.INVALID_STATE, 'This post has already gone out, or is being sent.')
export const postNotFailed = () => apiError(409, ErrorCodes.INVALID_STATE, 'Only a failed post can be tried again.')
