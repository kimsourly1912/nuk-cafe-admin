import type { CreatePostsInput } from '#shared/contracts/marketing'
import { POST_CAPTION_MAX, POST_SCHEDULE_MAX_DAYS } from '#shared/contracts/marketing'

/** Post to channels (M2a, D164): the dialog's state, its checks and the request. */
export interface PostForm {
  channelIds: string[]
  caption: string
  withPoster: boolean
  when: 'now' | 'later'
  /** `datetime-local` value in this device's time: `2026-10-15T18:30`. */
  at: string
}

const pad = (n: number) => String(n).padStart(2, '0')

/** A `datetime-local` value for `date` in this device's time. */
export function localInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** The next whole hour at least 30 minutes away: a sensible first choice for Later. */
export function suggestedTime(now: Date): string {
  const next = new Date(now.getTime() + 30 * 60_000)
  next.setMinutes(0, 0, 0)
  next.setHours(next.getHours() + 1)
  return localInputValue(next)
}

/** What's wrong with the form, per field; empty when it can be sent. */
export function postFormIssues(form: PostForm, now: Date): Partial<Record<'channelIds' | 'caption' | 'at', string>> {
  const issues: Partial<Record<'channelIds' | 'caption' | 'at', string>> = {}
  if (!form.channelIds.length) issues.channelIds = 'Choose at least one channel'
  const caption = form.caption.trim()
  if (!caption) issues.caption = 'Write a caption'
  else if (caption.length > POST_CAPTION_MAX) issues.caption = `At most ${POST_CAPTION_MAX} characters`
  if (form.when === 'later') {
    const at = new Date(form.at)
    if (!form.at || Number.isNaN(at.getTime())) issues.at = 'Choose a date and time'
    else if (at.getTime() <= now.getTime()) issues.at = 'That time has passed. Choose a later one, or Post now.'
    else if (at.getTime() > now.getTime() + POST_SCHEDULE_MAX_DAYS * 86_400_000) issues.at = `Choose a time within ${POST_SCHEDULE_MAX_DAYS} days.`
  }
  return issues
}

export function postRequest(form: PostForm, hasPoster: boolean): CreatePostsInput {
  return {
    channelIds: form.channelIds,
    caption: form.caption.trim(),
    withPoster: hasPoster && form.withPoster,
    at: form.when === 'later' ? new Date(form.at).toISOString() : null,
  }
}
