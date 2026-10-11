import { describe, expect, it } from 'vitest'
import type { PostForm } from '../schemas/post-form'
import { localInputValue, postFormIssues, postRequest, suggestedTime } from '../schemas/post-form'

const now = new Date(2026, 9, 15, 12, 10)
const form = (over: Partial<PostForm> = {}): PostForm => ({ channelIds: ['c1'], caption: ' Coffee week ', withPoster: true, when: 'now', at: '', ...over })

describe('post form', () => {
  it('formats and suggests times in this device\'s time', () => {
    expect(localInputValue(now)).toBe('2026-10-15T12:10')
    expect(suggestedTime(now)).toBe('2026-10-15T13:00')
    expect(suggestedTime(new Date(2026, 9, 15, 12, 40))).toBe('2026-10-15T14:00')
  })

  it('needs a channel, a caption and a time ahead within 30 days', () => {
    expect(postFormIssues(form(), now)).toEqual({})
    expect(postFormIssues(form({ channelIds: [], caption: '  ' }), now)).toEqual({ channelIds: 'Choose at least one channel', caption: 'Write a caption' })
    expect(postFormIssues(form({ caption: 'x'.repeat(1001) }), now).caption).toBe('At most 1000 characters')
    expect(postFormIssues(form({ when: 'later', at: '' }), now).at).toBe('Choose a date and time')
    expect(postFormIssues(form({ when: 'later', at: '2026-10-15T12:00' }), now).at).toMatch(/passed/)
    expect(postFormIssues(form({ when: 'later', at: '2026-11-20T12:00' }), now).at).toBe('Choose a time within 30 days.')
    expect(postFormIssues(form({ when: 'later', at: '2026-10-16T09:00' }), now)).toEqual({})
  })

  it('sends the trimmed caption, the poster only when there is one, and the time as ISO', () => {
    expect(postRequest(form(), true)).toEqual({ channelIds: ['c1'], caption: 'Coffee week', withPoster: true, at: null })
    expect(postRequest(form(), false).withPoster).toBe(false)
    expect(postRequest(form({ when: 'later', at: '2026-10-16T09:00' }), true).at).toBe(new Date(2026, 9, 16, 9, 0).toISOString())
  })
})
